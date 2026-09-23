package com.project.platform.offloading;

import com.project.platform.offloading.OffloadingService.*;
import com.project.platform.runtime.definition.JsonCodec;
import com.project.platform.runtime.model.WorkflowException;
import java.sql.*;
import java.time.Instant;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionTemplate;

/** Owns only off_* tables. Observations are evidence, not a second execution state machine. */
public final class JdbcOffloadingRepository {
    private final JdbcTemplate jdbc;private final JsonCodec json;private final TransactionTemplate transactions;
    public JdbcOffloadingRepository(JdbcTemplate jdbc,JsonCodec json,TransactionTemplate transactions){this.jdbc=jdbc;this.json=json;this.transactions=transactions;}
    public Sample get(String ns,String key) {
        var rows=jdbc.query("SELECT * FROM off_task_observation WHERE namespace=? AND allocation_id=?",this::sample,ns,key);
        return rows.isEmpty()?null:rows.getFirst();
    }
    public Sample begin(String ns,String key,String execution,Workload work,Target target,String strategy,String model,double[] state,Integer action,Double decisionMs,Double inferenceMs) {
        jdbc.update("""
                INSERT IGNORE INTO off_task_observation(namespace,allocation_id,execution_id,application_id,application_version,
                workload_json,input_bytes,target_kind,target_id,strategy,model_version,state_json,action_no,decision_ms,inference_ms)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """,ns,key,execution,work.applicationId(),work.version(),workload(work),work.inputBytes(),target.kind(),target.id(),strategy,model,state==null?null:json.write(state),action,decisionMs,inferenceMs);
        return get(ns,key);
    }
    public void started(String ns,String key,long inputBytes){jdbc.update("UPDATE off_task_observation SET started_at=CURRENT_TIMESTAMP(6),input_bytes=? WHERE namespace=? AND allocation_id=? AND started_at IS NULL AND finished_at IS NULL",inputBytes,ns,key);}
    public void finish(String ns,String key,String outcome){jdbc.update("UPDATE off_task_observation SET finished_at=CURRENT_TIMESTAMP(6),outcome=? WHERE namespace=? AND allocation_id=? AND finished_at IS NULL",outcome,ns,key);}
    public void placed(String ns,String key,Target target) {
        jdbc.update("UPDATE off_task_observation SET target_id=? WHERE namespace=? AND allocation_id=? AND target_kind=? AND target_id IS NULL AND finished_at IS NULL",target.id(),ns,key,target.kind());
        var saved=get(ns,key);
        if(saved==null || !saved.target().equals(target))throw WorkflowException.conflict("allocated position must match the frozen layer and position");
    }
    public Sample capture(String ns,String key,String edge,String terminal,String flow,Double[] inputs,List<Integer> legal,String unavailable,double[] state,double limit) {
        if(!org.springframework.transaction.support.TransactionSynchronizationManager.isActualTransactionActive())throw new IllegalStateException("capture requires Resource admission transaction");
        var current=get(ns,key);if(current.measurement()!=null)return current;
        jdbc.update("""
                UPDATE off_task_observation SET origin_edge=?,origin_terminal=?,flow_id=?,state_inputs_json=?,legal_actions_json=?,
                unavailable_reason=?,state_json=?,limit_seconds=? WHERE namespace=? AND allocation_id=? AND origin_edge IS NULL
                """,edge,terminal,flow,json.write(inputs),json.write(legal),unavailable,state==null?null:json.write(state),limit,ns,key);
        var prior=jdbc.queryForList("""
                SELECT allocation_id FROM off_task_observation WHERE namespace=? AND origin_edge=? AND flow_id=?
                AND application_id=? AND application_version=? AND workload_json=?
                AND sample_no<(SELECT sample_no FROM off_task_observation WHERE namespace=? AND allocation_id=?)
                ORDER BY sample_no DESC LIMIT 1
                """,ns,edge,flow,current.applicationId(),current.applicationVersion(),json.write(current.workload()),ns,key);
        if(!prior.isEmpty())jdbc.update("UPDATE off_task_observation SET next_allocation_id=? WHERE namespace=? AND allocation_id=? AND next_allocation_id IS NULL",key,ns,prior.getFirst().get("allocation_id"));
        return get(ns,key);
    }
    public void feedback(String ns,String execution,String terminal,String outcome,Double elapsed,Double reward) {
        transactions.executeWithoutResult(status->{
            var rows=jdbc.queryForList("SELECT allocation_id,feedback_outcome,elapsed_seconds FROM off_task_observation WHERE namespace=? AND execution_id=? AND origin_terminal=? FOR UPDATE",ns,execution,terminal);
            if(rows.size()!=1)throw WorkflowException.invalid("feedback","one eligible non-retrying task observation required");
            var row=rows.getFirst();
            if(row.get("feedback_outcome")!=null) {
                if(!outcome.equals(row.get("feedback_outcome")) || !Objects.equals(elapsed,row.get("elapsed_seconds")))throw WorkflowException.conflict("feedback already fixed with different values");
                return;
            }
            jdbc.update("UPDATE off_task_observation SET elapsed_seconds=?,feedback_outcome=?,feedback_reward=? WHERE namespace=? AND allocation_id=?",elapsed,outcome,reward,ns,row.get("allocation_id"));
        });
    }
    public List<Sample> list(String ns,int limit,int offset){return jdbc.query("SELECT * FROM off_task_observation WHERE namespace=? ORDER BY created_at,allocation_id LIMIT ? OFFSET ?",this::sample,ns,limit,offset);}
    public DqnModel model(String ns,String version) {
        var rows=jdbc.query("SELECT model_json FROM off_dqn_model WHERE namespace=? AND version=?",(rs,row)->json.read(rs.getString(1),DqnModel.class),ns,version);
        if(rows.isEmpty())throw WorkflowException.missing("offloading model version not found");return rows.getFirst();
    }
    public DqnModel register(String ns,String version,DqnModel model) {
        String encoded=json.write(model);
        jdbc.update("INSERT IGNORE INTO off_dqn_model(namespace,version,model_json) VALUES(?,?,?)",ns,version,encoded);
        var saved=model(ns,version);if(!json.write(saved).equals(encoded))throw WorkflowException.conflict("model version is immutable");return saved;
    }
    private String workload(Workload work){return json.write(Map.of("command",work.command(),"parameters",new TreeMap<>(work.parameters())));}
    private Sample sample(ResultSet rs,int row) throws SQLException {
        Instant created=rs.getTimestamp("created_at").toInstant(),started=instant(rs,"started_at"),finished=instant(rs,"finished_at");
        String outcome=rs.getString("outcome");Double reward=null;
        Measurement measurement=null;
        if(rs.getString("origin_edge")!=null) {
            String next=rs.getString("next_allocation_id");double[] nextState=null;List<Integer> nextLegal=List.of();
            if(next!=null) {
                var values=jdbc.queryForList("SELECT state_json,legal_actions_json FROM off_task_observation WHERE namespace=? AND allocation_id=?",rs.getString("namespace"),next);
                if(!values.isEmpty() && values.getFirst().get("state_json")!=null) {
                    nextState=json.read(values.getFirst().get("state_json").toString(),double[].class);
                    nextLegal=Arrays.asList(json.read(values.getFirst().get("legal_actions_json").toString(),Integer[].class));
                }
            }
            reward=(Double)rs.getObject("feedback_reward");
            measurement=new Measurement(rs.getString("origin_edge"),rs.getString("origin_terminal"),rs.getString("flow_id"),json.read(rs.getString("state_inputs_json"),Double[].class),
                    Arrays.asList(json.read(rs.getString("legal_actions_json"),Integer[].class)),rs.getString("unavailable_reason"),next,nextState,nextLegal,
                    (Double)rs.getObject("elapsed_seconds"),rs.getDouble("limit_seconds"),rs.getString("feedback_outcome"),
                    rs.getString("state_json")!=null && nextState!=null && reward!=null && finished!=null && !"CANCELLED".equals(outcome));
        } else if(finished!=null && started!=null && !"CANCELLED".equals(outcome))
            reward="SUCCESS".equals(outcome)?-Math.min(9,Math.log1p(Math.max(0,java.time.Duration.between(created,finished).toMillis())/1000.0)):-10.0;
        return new Sample(rs.getString("allocation_id"),rs.getString("execution_id"),rs.getString("application_id"),rs.getString("application_version"),
                json.map(rs.getString("workload_json")),rs.getLong("input_bytes"),new Target(rs.getString("target_kind"),rs.getString("target_id")),
                rs.getString("strategy"),rs.getString("model_version"),rs.getString("state_json")==null?null:json.read(rs.getString("state_json"),double[].class),
                (Integer)rs.getObject("action_no"),created,started,finished,outcome,reward,measurement,(Double)rs.getObject("decision_ms"),(Double)rs.getObject("inference_ms"));
    }
    private static Instant instant(ResultSet rs,String column) throws SQLException {var timestamp=rs.getTimestamp(column);return timestamp==null?null:timestamp.toInstant();}
}
