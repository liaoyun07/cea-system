package com.project.platform.runtime.persistence;

import com.project.platform.runtime.definition.JsonCodec;
import com.project.platform.runtime.model.*;
import com.project.platform.runtime.model.ExecutionRecord.*;
import java.sql.*;
import java.time.Instant;
import java.util.*;
import java.util.function.Supplier;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionTemplate;

/** Owns execution state; all writes are applied by the execution transaction, never by Worker. */
public final class JdbcExecutionStore {
    private final JdbcTemplate jdbc;
    private final TransactionTemplate transactions;
    private final JsonCodec json;
    public JdbcExecutionStore(JdbcTemplate jdbc,TransactionTemplate transactions,JsonCodec json) {
        this.jdbc=jdbc;this.transactions=transactions;this.json=json;
    }
    public <T>T transaction(Supplier<T> action) { return transactions.execute(status->action.get()); }
    public Instant now() { return jdbc.queryForObject("SELECT CURRENT_TIMESTAMP(6)",Timestamp.class).toInstant(); }
    public Submission findSubmission(String namespace,String actor,String key) {
        var rows=jdbc.query("SELECT id,request_hash FROM wf_execution WHERE namespace=? AND submitted_by=? AND request_key=?",
                (rs,row)->new Submission(rs.getString(1),rs.getString(2)),namespace,actor,key);
        return rows.isEmpty()?null:rows.getFirst();
    }
    public void create(ExecutionRecord execution,String key,String hash) {
        jdbc.update("""
                INSERT INTO wf_execution(id,namespace,flow_id,flow_revision,submitted_by,request_key,request_hash,
                state,definition_json,inputs_json,variables_json,outputs_json,created_at)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,'{}',?)
                """,execution.id(),execution.namespace(),execution.flowId(),execution.flowRevision(),execution.submittedBy(),
                key,hash,execution.state().name(),json.write(execution.definition()),json.write(execution.inputs()),json.write(execution.variables()),Timestamp.from(execution.createdAt()));
        int index=0;
        var repeated=new HashSet<String>();
        for(var spec:execution.definition().allTasks())if(spec.dynamic()) {
            var children=new ArrayList<FlowDefinition.Task>();FlowDefinition.flatten(spec.tasks(),children);
            children.forEach(child->repeated.add(child.id()));
        }
        for(var task:execution.definition().allTasks()) {
            if(repeated.contains(task.id())){index++;continue;}
            jdbc.update("INSERT INTO wf_task_run(id,execution_id,task_id,task_index,state,outputs_json,phase) VALUES(?,?,?,?,'CREATED','{}',?)",
                    UUID.randomUUID().toString(),execution.id(),task.id(),index,execution.definition().phaseAt(index).name());
            index++;
        }
        if(execution.state()==ExecutionState.CREATED) enqueue(execution.id());
        else if(execution.state()==ExecutionState.FAILED) {
            mainOutcome(execution.id(),ExecutionState.FAILED,"flow concurrency limit exceeded");
            skipBeforeAfter(execution,now());
            complete(execution.id(),ExecutionState.FAILED,Map.of(),now());
            if(!execution.definition().afterExecution().isEmpty())enqueue(execution.id());
        }
    }
    public record Message(long id,String executionId) {}
    public Message nextMessage() {
        var candidates=jdbc.query("SELECT m.id,e.namespace,e.flow_id FROM wf_message m JOIN wf_execution e ON e.id=m.execution_id WHERE m.available_at<=CURRENT_TIMESTAMP(6) ORDER BY m.id LIMIT 1",
                (rs,row)->Map.of("id",rs.getLong(1),"namespace",rs.getString(2),"flowId",rs.getString(3)));
        if(candidates.isEmpty()) return null;
        var candidate=candidates.getFirst();
        lockFlow((String)candidate.get("namespace"),(String)candidate.get("flowId"));
        var rows=jdbc.query("SELECT id,execution_id FROM wf_message WHERE id=? AND available_at<=CURRENT_TIMESTAMP(6) FOR UPDATE SKIP LOCKED",
                (rs,row)->new Message(rs.getLong(1),rs.getString(2)),candidate.get("id"));
        return rows.isEmpty()?null:rows.getFirst();
    }
    public void acknowledge(long id) { jdbc.update("DELETE FROM wf_message WHERE id=?",id); }
    public void enqueue(String id) { enqueueAt(id,now()); }
    public void enqueueAt(String id,Instant at) {
        jdbc.update("INSERT INTO wf_message(execution_id,available_at) VALUES(?,?)",id,Timestamp.from(at));
    }
    public ExecutionRecord lock(String id) { return jdbc.queryForObject("SELECT * FROM wf_execution WHERE id=? FOR UPDATE",this::execution,id); }
    public ExecutionRecord get(String namespace,String id) {
        var rows=jdbc.query("SELECT * FROM wf_execution WHERE namespace=? AND id=?",this::execution,namespace,id);
        if(rows.isEmpty()) throw WorkflowException.missing("execution not found");
        return rows.getFirst();
    }
    public List<ExecutionRecord> list(String namespace,int limit,int offset) {
        return jdbc.query("SELECT * FROM wf_execution WHERE namespace=? ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?",this::execution,namespace,limit,offset);
    }
    public List<TaskRun> tasks(String id) { return jdbc.query("SELECT * FROM wf_task_run WHERE execution_id=? ORDER BY task_index",this::task,id); }
    public List<TaskRun> scopedTasks(String id,String parent,int iteration) {
        return jdbc.query("SELECT * FROM wf_task_run WHERE execution_id=? AND parent_task_run_id <=> ? AND iteration=? ORDER BY task_index",this::task,id,parent,iteration);
    }
    public List<Attempt> attempts(String taskRunId) {
        return jdbc.query("SELECT * FROM wf_task_attempt WHERE task_run_id=? ORDER BY attempt_no",
                (rs,row)->new Attempt(taskRunId,rs.getInt("attempt_no"),ExecutionState.valueOf(rs.getString("state")),
                        instant(rs,"started_at"),instant(rs,"ended_at"),rs.getString("error_text")),taskRunId);
    }
    public List<LogEntry> logs(String id,long afterId,int limit) {
        return jdbc.query("SELECT * FROM wf_log WHERE execution_id=? AND id>? ORDER BY id LIMIT ?",
                (rs,row)->new LogEntry(rs.getLong("id"),id,rs.getString("task_run_id"),rs.getInt("attempt_no"),
                        rs.getString("level"),rs.getString("message"),instant(rs,"created_at")),id,afterId,limit);
    }
    public Map<String,Map<String,Object>> successfulOutputs(String id) {
        var outputs=new LinkedHashMap<String,Map<String,Object>>();
        for(var task:scopedTasks(id,null,0)) if(task.state()==ExecutionState.SUCCESS) outputs.put(task.taskId(),task.outputs());
        return outputs;
    }
    public void createIteration(TaskRun parent,int iteration,List<FlowDefinition.Task> children) {
        if(jdbc.queryForObject("SELECT COUNT(*) FROM wf_task_run WHERE parent_task_run_id=? AND iteration=?",Integer.class,parent.id(),iteration)>0)return;
        int index=jdbc.queryForObject("SELECT COALESCE(MAX(task_index),-1)+1 FROM wf_task_run WHERE execution_id=?",Integer.class,parent.executionId());
        var flattened=new ArrayList<FlowDefinition.Task>();flattenScope(children,flattened);
        for(var task:flattened)jdbc.update("INSERT INTO wf_task_run(id,execution_id,task_id,task_index,state,outputs_json,phase,parent_task_run_id,iteration) VALUES(?,?,?,?,'CREATED','{}',?,?,?)",
                UUID.randomUUID().toString(),parent.executionId(),task.id(),index++,parent.phase().name(),parent.id(),iteration);
    }
    private void flattenScope(List<FlowDefinition.Task> tasks,List<FlowDefinition.Task> target) {
        for(var task:tasks) {
            target.add(task);
            if(!task.dynamic())flattenScope(task.tasks(),target);
            flattenScope(task.thenTasks(),target);flattenScope(task.elseTasks(),target);
        }
    }
    public List<Integer> iterations(String parent) {
        return jdbc.queryForList("SELECT DISTINCT iteration FROM wf_task_run WHERE parent_task_run_id=? ORDER BY iteration",Integer.class,parent);
    }
    public void startExecution(String id,Instant now) {
        jdbc.update("UPDATE wf_execution SET state='RUNNING',started_at=? WHERE id=?",Timestamp.from(now),id);
    }
    public void startTask(TaskRun task,int attempt,Instant now) {
        jdbc.update("UPDATE wf_task_run SET state='RUNNING',started_at=COALESCE(started_at,?),ended_at=NULL,error_text=NULL,retry_at=NULL WHERE id=?",Timestamp.from(now),task.id());
        jdbc.update("INSERT INTO wf_task_attempt(task_run_id,attempt_no,state,started_at) VALUES(?,?,'RUNNING',?)",task.id(),attempt,Timestamp.from(now));
    }
    public void finishAttempt(TaskRun task,int attempt,ExecutionState state,Map<String,Object> outputs,String error,Instant now) {
        jdbc.update("UPDATE wf_task_attempt SET state=?,ended_at=?,error_text=? WHERE task_run_id=? AND attempt_no=?",
                state.name(),Timestamp.from(now),error,task.id(),attempt);
        jdbc.update("UPDATE wf_task_run SET state=?,outputs_json=?,ended_at=?,error_text=?,retry_at=NULL WHERE id=?",
                state.name(),json.write(outputs),Timestamp.from(now),error,task.id());
    }
    public void retry(TaskRun task,Instant at) {
        jdbc.update("UPDATE wf_task_run SET state='RETRYING',retry_at=?,ended_at=NULL WHERE id=?",Timestamp.from(at),task.id());
    }
    public void killTask(TaskRun task,Instant now) {
        jdbc.update("UPDATE wf_task_attempt SET state='KILLED',ended_at=?,error_text='cancelled' WHERE task_run_id=? AND state='RUNNING'",Timestamp.from(now),task.id());
        jdbc.update("UPDATE wf_task_run SET state='KILLED',ended_at=?,error_text='cancelled',retry_at=NULL WHERE id=?",Timestamp.from(now),task.id());
    }
    public void controlState(TaskRun task,ExecutionState state,Map<String,Object> outputs,String error,Instant now) {
        jdbc.update("UPDATE wf_task_run SET state=?,outputs_json=?,error_text=?,started_at=COALESCE(started_at,?),ended_at=? WHERE id=?",
                state.name(),json.write(outputs),error,Timestamp.from(now),state.terminal()?Timestamp.from(now):null,task.id());
    }
    public void mainOutcome(String id,ExecutionState state,String error) {
        jdbc.update("UPDATE wf_execution SET main_state=?,error_text=? WHERE id=?",state.name(),error,id);
    }
    public void cleanupError(String id,String error) { jdbc.update("UPDATE wf_execution SET cleanup_error=COALESCE(cleanup_error,?) WHERE id=?",error,id); }
    public void skip(String id,int from,int to,Instant now) {
        jdbc.update("UPDATE wf_task_run SET state='SKIPPED',ended_at=? WHERE execution_id=? AND task_index>=? AND task_index<? AND state='CREATED'",
                Timestamp.from(now),id,from,to);
    }
    public void complete(String id,ExecutionState state,Map<String,Object> outputs,Instant now) {
        jdbc.update("UPDATE wf_execution SET state=?,outputs_json=?,ended_at=? WHERE id=?",state.name(),json.write(outputs),Timestamp.from(now),id);
    }
    public void slaViolated(String id,Instant at) {
        jdbc.update("UPDATE wf_execution SET sla_violated_at=COALESCE(sla_violated_at,?) WHERE id=?",Timestamp.from(at),id);
    }
    private void skipBeforeAfter(ExecutionRecord execution,Instant now) {
        int count=0;
        while(count<execution.definition().allTasks().size() && execution.definition().phaseAt(count)!=FlowDefinition.Phase.AFTER_EXECUTION)count++;
        skip(execution.id(),0,count,now);
    }
    public void log(String id,String taskRunId,int attempt,String level,String text,Instant now) {
        jdbc.update("INSERT INTO wf_log(execution_id,task_run_id,attempt_no,entry_no,level,message,created_at) VALUES(?,?,?,1,?,?,?)",
                id,taskRunId,attempt,level,text,Timestamp.from(now));
    }
    public void lockFlow(String namespace,String flowId) {
        jdbc.update("INSERT INTO wf_flow_control(namespace,flow_id) VALUES(?,?) ON DUPLICATE KEY UPDATE flow_id=flow_id",namespace,flowId);
        jdbc.queryForObject("SELECT flow_id FROM wf_flow_control WHERE namespace=? AND flow_id=? FOR UPDATE",String.class,namespace,flowId);
    }
    public void configureConcurrency(FlowDefinition flow) {
        lockFlow(flow.namespace(),flow.id());
        jdbc.update("UPDATE wf_flow_control SET concurrency_limit=?,behavior=? WHERE namespace=? AND flow_id=?",
                flow.concurrency()==null?null:flow.concurrency().limit(),flow.concurrency()==null?"QUEUE":flow.concurrency().behavior().name(),flow.namespace(),flow.id());
        promote(flow.namespace(),flow.id());
    }
    private int available(String namespace,String flowId) {
        Integer limit=jdbc.queryForObject("SELECT concurrency_limit FROM wf_flow_control WHERE namespace=? AND flow_id=?",Integer.class,namespace,flowId);
        if(limit==null) return Integer.MAX_VALUE;
        int active=jdbc.queryForObject("SELECT COUNT(*) FROM wf_execution WHERE namespace=? AND flow_id=? AND state IN ('CREATED','RUNNING','KILLING')",Integer.class,namespace,flowId);
        return Math.max(0,limit-active);
    }
    public ExecutionState admission(String namespace,String flowId) {
        promote(namespace,flowId);
        if(available(namespace,flowId)>0) return ExecutionState.CREATED;
        String behavior=jdbc.queryForObject("SELECT behavior FROM wf_flow_control WHERE namespace=? AND flow_id=?",String.class,namespace,flowId);
        return "FAIL".equals(behavior)?ExecutionState.FAILED:ExecutionState.QUEUED;
    }
    public void promote(String namespace,String flowId) {
        int free=available(namespace,flowId);
        if(free==0) return;
        var ids=jdbc.queryForList("SELECT id FROM wf_execution WHERE namespace=? AND flow_id=? AND state='QUEUED' ORDER BY sequence_no LIMIT ? FOR UPDATE",String.class,namespace,flowId,free);
        for(String id:ids) { jdbc.update("UPDATE wf_execution SET state='CREATED' WHERE id=?",id); enqueue(id); }
    }
    // Same Flow -> Message -> Execution order as Executor and admission.
    public void requestCancel(String namespace,String id) {
        transaction(()->{
            var found=get(namespace,id);
            lockFlow(namespace,found.flowId());
            jdbc.update("UPDATE wf_message SET available_at=CURRENT_TIMESTAMP(6) WHERE execution_id=?",id);
            var current=lock(id);
            if(current.state()==ExecutionState.QUEUED) {
                mainOutcome(id,ExecutionState.KILLED,"cancelled before admission");
                skipBeforeAfter(current,now());
                complete(id,ExecutionState.KILLED,Map.of(),now());
                if(!current.definition().afterExecution().isEmpty())enqueue(id);
                promote(namespace,current.flowId());
                return null;
            }
            if(!current.state().terminal() && current.state()!=ExecutionState.KILLING) {
                jdbc.update("UPDATE wf_execution SET state='KILLING' WHERE id=?",id);
            }
            return null;
        });
    }
    private ExecutionRecord execution(ResultSet rs,int row)throws SQLException {
        String main=rs.getString("main_state");
        return new ExecutionRecord(rs.getString("id"),rs.getString("namespace"),rs.getString("flow_id"),rs.getInt("flow_revision"),
                rs.getString("submitted_by"),ExecutionState.valueOf(rs.getString("state")),
                json.flow(rs.getString("definition_json")),json.map(rs.getString("inputs_json")),json.map(rs.getString("variables_json")),
                json.map(rs.getString("outputs_json")),instant(rs,"created_at"),instant(rs,"started_at"),instant(rs,"ended_at"),
                rs.getString("error_text"),main==null?null:ExecutionState.valueOf(main),rs.getString("cleanup_error"),instant(rs,"sla_violated_at"));
    }
    private TaskRun task(ResultSet rs,int row)throws SQLException {
        return new TaskRun(rs.getString("id"),rs.getString("execution_id"),rs.getString("task_id"),rs.getInt("task_index"),
                ExecutionState.valueOf(rs.getString("state")),json.map(rs.getString("outputs_json")),instant(rs,"started_at"),
                instant(rs,"ended_at"),rs.getString("error_text"),FlowDefinition.Phase.valueOf(rs.getString("phase")),instant(rs,"retry_at"),rs.getString("parent_task_run_id"),rs.getInt("iteration"));
    }
    private static Instant instant(ResultSet rs,String column)throws SQLException {
        Timestamp value=rs.getTimestamp(column); return value==null?null:value.toInstant();
    }
}
