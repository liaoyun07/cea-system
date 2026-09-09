package com.project.platform.runtime.persistence;

import com.project.platform.runtime.definition.JsonCodec;
import com.project.platform.runtime.worker.WorkerJob;
import com.project.platform.runtime.worker.WorkerJob.*;
import java.sql.Timestamp;
import java.time.Instant;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionTemplate;

/** Owns the durable Worker transport. Worker methods never mutate execution/task/attempt tables. */
public final class JdbcWorkerStore {
    private final JdbcTemplate jdbc;
    private final TransactionTemplate transactions;
    private final JsonCodec json;
    public JdbcWorkerStore(JdbcTemplate jdbc, TransactionTemplate transactions, JsonCodec json) {
        this.jdbc=jdbc; this.transactions=transactions; this.json=json;
    }
    // Executor calls dispatch/remove/result while holding the execution transaction.
    public void dispatch(WorkerJob job, Instant deadline) {
        jdbc.update("INSERT INTO wf_worker_job(task_run_id,attempt_no,state,payload_json,deadline) VALUES(?,?,'READY',?,?)",
                job.taskRunId(),job.attemptNo(),json.write(job),deadline==null?null:Timestamp.from(deadline));
    }
    public Result result(String taskRunId,int attempt) {
        var rows=jdbc.query("SELECT result_json FROM wf_worker_job WHERE task_run_id=? AND attempt_no=? AND state='RESULT' FOR UPDATE",
                (rs,row)->json.read(rs.getString(1),Result.class),taskRunId,attempt);
        return rows.isEmpty()?null:rows.getFirst();
    }
    public void remove(String taskRunId,int attempt) {
        jdbc.update("DELETE FROM wf_worker_job WHERE task_run_id=? AND attempt_no=?",taskRunId,attempt);
    }
    public Lease claim(String owner,long leaseMs) {
        return transactions.execute(status->{
            var rows=jdbc.query("""
                    SELECT payload_json,epoch FROM wf_worker_job
                    WHERE (state='READY' OR (state='RUNNING' AND lease_until<=CURRENT_TIMESTAMP(6)))
                      AND (deadline IS NULL OR deadline>CURRENT_TIMESTAMP(6))
                    ORDER BY task_run_id,attempt_no LIMIT 1 FOR UPDATE SKIP LOCKED
                    """,(rs,row)->new Lease(json.read(rs.getString(1),WorkerJob.class),rs.getLong(2)+1,owner));
            if(rows.isEmpty()) return null;
            Lease lease=rows.getFirst();
            jdbc.update("""
                    UPDATE wf_worker_job SET state='RUNNING',epoch=?,owner=?,
                    lease_until=TIMESTAMPADD(MICROSECOND,?,CURRENT_TIMESTAMP(6))
                    WHERE task_run_id=? AND attempt_no=?
                    """,lease.epoch(),owner,leaseMs*1000,lease.job().taskRunId(),lease.job().attemptNo());
            return lease;
        });
    }
    public boolean heartbeat(Lease lease,long leaseMs) {
        return jdbc.update("""
                UPDATE wf_worker_job SET lease_until=TIMESTAMPADD(MICROSECOND,?,CURRENT_TIMESTAMP(6))
                WHERE task_run_id=? AND attempt_no=? AND epoch=? AND owner=? AND state='RUNNING'
                AND lease_until>CURRENT_TIMESTAMP(6) AND (deadline IS NULL OR deadline>CURRENT_TIMESTAMP(6))
                """,leaseMs*1000,lease.job().taskRunId(),lease.job().attemptNo(),lease.epoch(),lease.owner())==1;
    }
    public boolean finish(Lease lease,Result result) {
        return jdbc.update("""
                UPDATE wf_worker_job SET state='RESULT',result_json=?
                WHERE task_run_id=? AND attempt_no=? AND epoch=? AND owner=? AND state='RUNNING'
                AND lease_until>CURRENT_TIMESTAMP(6) AND (deadline IS NULL OR deadline>CURRENT_TIMESTAMP(6))
                """,json.write(result),lease.job().taskRunId(),lease.job().attemptNo(),lease.epoch(),lease.owner())==1;
    }
}
