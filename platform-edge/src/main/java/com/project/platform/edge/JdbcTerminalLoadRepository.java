package com.project.platform.edge;

import com.project.platform.edge.TerminalLoad.*;
import com.project.platform.runtime.definition.JsonCodec;
import com.project.platform.runtime.model.WorkflowException;
import java.sql.*;
import java.time.Instant;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;

public final class JdbcTerminalLoadRepository {
    private final JdbcTemplate jdbc;
    private final JsonCodec json;
    public JdbcTerminalLoadRepository(JdbcTemplate jdbc,JsonCodec json){this.jdbc=jdbc;this.json=json;}
    public List<Device> devices(String ns) {
        return jdbc.query("SELECT * FROM edge_terminal WHERE namespace=? ORDER BY id",(r,n)->new Device(
            new EdgeAccess.Terminal(r.getString("id"),r.getString("gateway_id"),r.getBoolean("enabled"),time(r,"last_seen_at")),
            r.getString("resource_json")==null?null:json.read(r.getString("resource_json"),Resource.class),time(r,"resource_at"),r.getString("load_run_id")),ns);
    }
    public String assignment(String ns,String terminal,boolean lock) {
        return jdbc.queryForObject("SELECT load_run_id FROM edge_terminal WHERE namespace=? AND id=?"+(lock?" FOR UPDATE":""),String.class,ns,terminal);
    }
    public void assign(String ns,String terminal,String run) {
        jdbc.update("UPDATE edge_terminal SET load_run_id=? WHERE namespace=? AND id=?",run,ns,terminal);
    }
    public void create(String ns,String id,Config config,String strategy,Instant now) {
        jdbc.update("INSERT INTO edge_load_run VALUES(?,?,?,1,TRUE,?,NULL)",ns,id,json.write(config),Timestamp.from(now));
        jdbc.update("INSERT INTO edge_load_phase VALUES(?,?,1,?,?,NULL)",ns,id,strategy,Timestamp.from(now));
    }
    public Run run(String ns,String id,boolean lock) {
        var rows=jdbc.query("SELECT * FROM edge_load_run WHERE namespace=? AND id=?"+(lock?" FOR UPDATE":""),this::run,ns,id);
        if(rows.isEmpty())throw WorkflowException.missing("load run not found");return rows.getFirst();
    }
    public List<Run> runs(String ns,int limit,int offset) {
        return jdbc.query("SELECT * FROM edge_load_run WHERE namespace=? ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?",this::run,ns,limit,offset);
    }
    private Run run(ResultSet r,int row)throws SQLException {
        return new Run(r.getString("id"),json.read(r.getString("config_json"),Config.class),r.getInt("active_phase"),r.getBoolean("sending"),time(r,"created_at"),time(r,"stopped_at"));
    }
    public List<Phase> phases(String ns,String run) {
        return jdbc.query("SELECT * FROM edge_load_phase WHERE namespace=? AND run_id=? ORDER BY phase_no",(r,n)->new Phase(r.getInt("phase_no"),r.getString("strategy"),time(r,"began_at"),time(r,"ended_at")),ns,run);
    }
    public void switchPhase(String ns,Run run,String strategy,Instant now) {
        endPhase(ns,run,now);
        jdbc.update("INSERT INTO edge_load_phase VALUES(?,?,?,?,?,NULL)",ns,run.id(),run.activePhase()+1,strategy,Timestamp.from(now));
        jdbc.update("UPDATE edge_load_run SET active_phase=active_phase+1 WHERE namespace=? AND id=?",ns,run.id());
    }
    private void endPhase(String ns,Run run,Instant now) {
        jdbc.update("UPDATE edge_load_phase SET ended_at=? WHERE namespace=? AND run_id=? AND phase_no=?",Timestamp.from(now),ns,run.id(),run.activePhase());
    }
    public void stop(String ns,Run run,Instant now) {
        endPhase(ns,run,now);
        jdbc.update("UPDATE edge_load_run SET sending=FALSE,stopped_at=? WHERE namespace=? AND id=?",Timestamp.from(now),ns,run.id());
    }
    public void resource(String ns,String terminal,Resource value,Instant now,String run) {
        jdbc.update("UPDATE edge_terminal SET resource_json=?,resource_at=? WHERE namespace=? AND id=?",json.write(value),Timestamp.from(now),ns,terminal);
        if(run!=null)jdbc.update("INSERT INTO edge_load_sample(namespace,run_id,terminal_id,sampled_at,resource_json) VALUES(?,?,?,?,?)",ns,run,terminal,Timestamp.from(now),json.write(value));
    }
    public void accepted(String ns,String run,String terminal,String request,int phase,String execution,Instant now) {
        jdbc.update("INSERT INTO edge_load_request(namespace,run_id,terminal_id,request_id,phase_no,execution_id,accepted_at) VALUES(?,?,?,?,?,?,?)",ns,run,terminal,request,phase,execution,Timestamp.from(now));
    }
    public Request request(String ns,String run,String terminal,String request) {
        var rows=jdbc.query("SELECT * FROM edge_load_request WHERE namespace=? AND run_id=? AND terminal_id=? AND request_id=?",this::request,ns,run,terminal,request);
        return rows.isEmpty()?null:rows.getFirst();
    }
    public void report(String ns,String terminal,Report report,Instant now) {
        jdbc.update("""
            INSERT INTO edge_load_request(namespace,run_id,terminal_id,request_id,accepted_at,finished_at,elapsed_seconds,outcome,error_text)
            VALUES(?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE
            elapsed_seconds=IF(finished_at IS NULL,VALUES(elapsed_seconds),elapsed_seconds),
            outcome=IF(finished_at IS NULL,VALUES(outcome),outcome),error_text=IF(finished_at IS NULL,VALUES(error_text),error_text),
            finished_at=COALESCE(finished_at,VALUES(finished_at))
            """,ns,report.runId(),terminal,report.requestId(),Timestamp.from(now),Timestamp.from(now),report.elapsedSeconds(),report.outcome(),report.error());
    }
    public List<Request> requests(String ns,String run,Instant from,Instant to) {
        return jdbc.query("SELECT * FROM edge_load_request WHERE namespace=? AND run_id=? AND accepted_at<=? AND (finished_at IS NULL OR finished_at>=?) ORDER BY accepted_at,request_id",this::request,ns,run,Timestamp.from(to),Timestamp.from(from));
    }
    private Request request(ResultSet r,int row)throws SQLException {
        return new Request(r.getString("terminal_id"),r.getString("request_id"),(Integer)r.getObject("phase_no"),r.getString("execution_id"),time(r,"accepted_at"),time(r,"finished_at"),(Double)r.getObject("elapsed_seconds"),r.getString("outcome"),r.getString("error_text"));
    }
    public List<Sample> samples(String ns,String run,Instant from,Instant to) {
        return jdbc.query("SELECT * FROM edge_load_sample WHERE namespace=? AND run_id=? AND sampled_at BETWEEN ? AND ? ORDER BY sampled_at,id",(r,n)->new Sample(r.getString("terminal_id"),time(r,"sampled_at"),json.read(r.getString("resource_json"),Resource.class)),ns,run,Timestamp.from(from),Timestamp.from(to));
    }
    private static Instant time(ResultSet r,String key)throws SQLException {var t=r.getTimestamp(key);return t==null?null:t.toInstant();}
}
