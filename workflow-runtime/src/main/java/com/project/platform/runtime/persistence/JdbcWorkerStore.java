package com.project.platform.runtime.persistence;

import com.project.platform.runtime.definition.JsonCodec;
import com.project.platform.runtime.worker.WorkerJob;
import com.project.platform.runtime.worker.WorkerJob.*;
import java.sql.Timestamp;
import java.time.Instant;
import java.sql.Connection;
import java.sql.SQLException;
import java.util.Set;
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
        jdbc.update("INSERT INTO wf_worker_job(task_run_id,attempt_no,state,payload_json,deadline,priority) VALUES(?,?,'READY',?,?,?)",
                job.taskRunId(),job.attemptNo(),json.write(job),deadline==null?null:Timestamp.from(deadline),job.task().effectivePriority());
    }
    public Result result(String taskRunId,int attempt) {
        var rows=jdbc.query("SELECT result_json FROM wf_worker_job WHERE task_run_id=? AND attempt_no=? AND state='RESULT' FOR UPDATE",
                (rs,row)->json.read(rs.getString(1),Result.class),taskRunId,attempt);
        return rows.isEmpty()?null:rows.getFirst();
    }
    public void remove(String taskRunId,int attempt) {
        jdbc.update("DELETE FROM wf_worker_job WHERE task_run_id=? AND attempt_no=?",taskRunId,attempt);
    }
    public void cancel(String taskRunId,int attempt,String reason) {
        jdbc.update("UPDATE wf_worker_job SET cancel_reason=COALESCE(cancel_reason,?) WHERE task_run_id=? AND attempt_no=?",reason,taskRunId,attempt);
    }
    public boolean owned(Lease lease) {
        return Boolean.TRUE.equals(jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM wf_worker_job WHERE task_run_id=? AND attempt_no=? AND epoch=? AND owner=? AND state='RUNNING' AND lease_until>CURRENT_TIMESTAMP(6))",Boolean.class,
                lease.job().taskRunId(),lease.job().attemptNo(),lease.epoch(),lease.owner()));
    }
    public String cancellation(Lease lease) {return jdbc.queryForObject("SELECT cancel_reason FROM wf_worker_job WHERE task_run_id=? AND attempt_no=?",String.class,lease.job().taskRunId(),lease.job().attemptNo());}
    public String prepared(Lease lease) {return jdbc.queryForObject("SELECT prepared_json FROM wf_worker_job WHERE task_run_id=? AND attempt_no=?",String.class,lease.job().taskRunId(),lease.job().attemptNo());}
    public boolean prepare(Lease lease,String value) {
        return jdbc.update("UPDATE wf_worker_job SET prepared_json=? WHERE task_run_id=? AND attempt_no=? AND epoch=? AND owner=? AND state='RUNNING' AND lease_until>CURRENT_TIMESTAMP(6) AND prepared_json IS NULL",
                value,lease.job().taskRunId(),lease.job().attemptNo(),lease.epoch(),lease.owner())==1;
    }
    public boolean stop(Lease lease,String reason) {
        return jdbc.update("UPDATE wf_worker_job SET cancel_reason=COALESCE(cancel_reason,?) WHERE task_run_id=? AND attempt_no=? AND epoch=? AND owner=? AND state='RUNNING' AND lease_until>CURRENT_TIMESTAMP(6)",
                reason,lease.job().taskRunId(),lease.job().attemptNo(),lease.epoch(),lease.owner())==1;
    }
    public Lease claim(String owner,long leaseMs) {
        return claim(owner,leaseMs,Set.of());
    }
    public Lease claim(String owner,long leaseMs,Set<String> skipped) {
        return transactions.execute(status->{
            String exclusion=skipped.isEmpty()?"":" AND task_run_id NOT IN ("+String.join(",",java.util.Collections.nCopies(skipped.size(),"?"))+")";
            var rows=jdbc.query("""
                    SELECT payload_json,epoch FROM wf_worker_job
                    WHERE (state='READY' OR (state='RUNNING' AND lease_until<=CURRENT_TIMESTAMP(6)))
                      AND (deadline IS NULL OR deadline>CURRENT_TIMESTAMP(6) OR cancel_reason IS NOT NULL)
                    """+exclusion+" ORDER BY (cancel_reason IS NOT NULL) DESC,(state='RUNNING') DESC,priority DESC,enqueue_order LIMIT 1 FOR UPDATE SKIP LOCKED",
                    (rs,row)->new Lease(json.read(rs.getString(1),WorkerJob.class),rs.getLong(2)+1,owner),skipped.toArray());
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
    public boolean defer(Lease lease) {
        return jdbc.update("""
                UPDATE wf_worker_job SET state='READY',owner=NULL,lease_until=NULL
                WHERE task_run_id=? AND attempt_no=? AND epoch=? AND owner=? AND state='RUNNING'
                AND lease_until>CURRENT_TIMESTAMP(6) AND prepared_json IS NULL
                """,lease.job().taskRunId(),lease.job().attemptNo(),lease.epoch(),lease.owner())==1;
    }
    /** Session lock serializes admission across workers without holding a transaction over resource probes. */
    public AdmissionLock admissionLock() throws SQLException {
        Connection connection=jdbc.getDataSource().getConnection();
        try {
            String name="cea-admission:"+connection.getCatalog();
            try(var statement=connection.prepareStatement("SELECT GET_LOCK(?,0)")) {
                statement.setString(1,name);
                try(var result=statement.executeQuery()) {
                    result.next();
                    if(result.getInt(1)==1)return new AdmissionLock(connection,name);
                }
            }
            connection.close();return null;
        } catch(SQLException error){connection.close();throw error;}
    }
    public record AdmissionLock(Connection connection,String name) implements AutoCloseable {
        @Override public void close() throws SQLException {
            try(var statement=connection.prepareStatement("SELECT RELEASE_LOCK(?)")) {
                statement.setString(1,name);statement.execute();
            } finally {connection.close();}
        }
    }
    public boolean heartbeat(Lease lease,long leaseMs) {
        return jdbc.update("""
                UPDATE wf_worker_job SET lease_until=TIMESTAMPADD(MICROSECOND,?,CURRENT_TIMESTAMP(6))
                WHERE task_run_id=? AND attempt_no=? AND epoch=? AND owner=? AND state='RUNNING'
                AND lease_until>CURRENT_TIMESTAMP(6) AND (deadline IS NULL OR deadline>CURRENT_TIMESTAMP(6) OR cancel_reason IS NOT NULL)
                """,leaseMs*1000,lease.job().taskRunId(),lease.job().attemptNo(),lease.epoch(),lease.owner())==1;
    }
    public boolean finish(Lease lease,Result result) {
        return jdbc.update("""
                UPDATE wf_worker_job SET state='RESULT',result_json=?
                WHERE task_run_id=? AND attempt_no=? AND epoch=? AND owner=? AND state='RUNNING'
                AND lease_until>CURRENT_TIMESTAMP(6) AND (deadline IS NULL OR deadline>CURRENT_TIMESTAMP(6) OR cancel_reason IS NOT NULL)
                """,json.write(result),lease.job().taskRunId(),lease.job().attemptNo(),lease.epoch(),lease.owner())==1;
    }
}
