package com.project.platform.offloading;

import com.project.platform.offloading.OffloadingService.*;
import com.project.platform.runtime.definition.JsonCodec;
import com.project.platform.runtime.model.WorkflowException;
import java.sql.*;
import java.time.Instant;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;

/** Owns only off_* tables. Observations are evidence, not a second execution state machine. */
public final class JdbcOffloadingRepository {
    private final JdbcTemplate jdbc;private final JsonCodec json;
    public JdbcOffloadingRepository(JdbcTemplate jdbc,JsonCodec json){this.jdbc=jdbc;this.json=json;}
    public Sample get(String ns,String key) {
        var rows=jdbc.query("SELECT * FROM off_task_observation WHERE namespace=? AND allocation_id=?",this::sample,ns,key);
        return rows.isEmpty()?null:rows.getFirst();
    }
    public Sample begin(String ns,String key,String execution,Workload work,Target target,String strategy,String model,double[] state,Integer action) {
        jdbc.update("""
                INSERT IGNORE INTO off_task_observation(namespace,allocation_id,execution_id,application_id,application_version,
                workload_json,input_bytes,target_kind,target_id,strategy,model_version,state_json,action_no)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
                """,ns,key,execution,work.applicationId(),work.version(),workload(work),work.inputBytes(),target.kind(),target.id(),strategy,model,state==null?null:json.write(state),action);
        return get(ns,key);
    }
    public void started(String ns,String key,long inputBytes){jdbc.update("UPDATE off_task_observation SET started_at=CURRENT_TIMESTAMP(6),input_bytes=? WHERE namespace=? AND allocation_id=? AND started_at IS NULL AND finished_at IS NULL",inputBytes,ns,key);}
    public void finish(String ns,String key,String outcome){jdbc.update("UPDATE off_task_observation SET finished_at=CURRENT_TIMESTAMP(6),outcome=? WHERE namespace=? AND allocation_id=? AND finished_at IS NULL",outcome,ns,key);}
    public void placed(String ns,String key,Target target) {
        jdbc.update("UPDATE off_task_observation SET target_id=? WHERE namespace=? AND allocation_id=? AND target_kind=? AND target_id IS NULL AND finished_at IS NULL",target.id(),ns,key,target.kind());
        var saved=get(ns,key);
        if(saved==null || !saved.target().equals(target))throw WorkflowException.conflict("allocated position must match the frozen layer and position");
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
        if(finished!=null && started!=null && !"CANCELLED".equals(outcome))
            reward="SUCCESS".equals(outcome)?-Math.min(9,Math.log1p(Math.max(0,java.time.Duration.between(created,finished).toMillis())/1000.0)):-10.0;
        return new Sample(rs.getString("allocation_id"),rs.getString("execution_id"),rs.getString("application_id"),rs.getString("application_version"),
                json.map(rs.getString("workload_json")),rs.getLong("input_bytes"),new Target(rs.getString("target_kind"),rs.getString("target_id")),
                rs.getString("strategy"),rs.getString("model_version"),rs.getString("state_json")==null?null:json.read(rs.getString("state_json"),double[].class),
                (Integer)rs.getObject("action_no"),created,started,finished,outcome,reward);
    }
    private static Instant instant(ResultSet rs,String column) throws SQLException {var timestamp=rs.getTimestamp(column);return timestamp==null?null:timestamp.toInstant();}
}
