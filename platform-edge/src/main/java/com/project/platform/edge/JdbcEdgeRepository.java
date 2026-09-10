package com.project.platform.edge;

import com.project.platform.edge.EdgeAccess.*;
import com.project.platform.runtime.model.WorkflowException;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;

public final class JdbcEdgeRepository {
    public record Receipt(String hash,String executionId) {}
    private final JdbcTemplate jdbc;
    public JdbcEdgeRepository(JdbcTemplate jdbc) { this.jdbc=jdbc; }
    public Gateway putGateway(String ns,String id,GatewayRegistration value) {
        jdbc.update("INSERT INTO edge_gateway(namespace,id,cluster_id,principal,enabled) VALUES(?,?,?,?,?) ON DUPLICATE KEY UPDATE id=id",ns,id,value.clusterId(),value.principal(),value.enabled());
        var rows=jdbc.query("SELECT * FROM edge_gateway WHERE namespace=? AND id=? FOR UPDATE",this::gateway,ns,id);
        if(rows.isEmpty()) throw WorkflowException.conflict("principal already belongs to another gateway");
        var saved=rows.getFirst();
        if(!saved.clusterId().equals(value.clusterId()) || !saved.principal().equals(value.principal()))
            throw WorkflowException.conflict("gateway cluster/principal cannot be reassigned; register a new gateway");
        jdbc.update("UPDATE edge_gateway SET enabled=? WHERE namespace=? AND id=?",value.enabled(),ns,id);
        return gateway(ns,id);
    }
    public Gateway gateway(String ns,String id) {
        return one(jdbc.query("SELECT * FROM edge_gateway WHERE namespace=? AND id=?",this::gateway,ns,id),"gateway");
    }
    public Gateway gatewayForPrincipal(String ns,String principal) {
        return one(jdbc.query("SELECT * FROM edge_gateway WHERE namespace=? AND principal=?",this::gateway,ns,principal),"gateway");
    }
    public List<Gateway> gateways(String ns,int limit,int offset) {
        return jdbc.query("SELECT * FROM edge_gateway WHERE namespace=? ORDER BY id LIMIT ? OFFSET ?",this::gateway,ns,limit,offset);
    }
    public Gateway heartbeat(String ns,String id) {
        jdbc.update("UPDATE edge_gateway SET last_seen_at=CURRENT_TIMESTAMP(6) WHERE namespace=? AND id=?",ns,id);
        return gateway(ns,id);
    }
    public Terminal putTerminal(String ns,String id,TerminalRegistration value) {
        jdbc.update("INSERT INTO edge_terminal(namespace,id,gateway_id,enabled) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE enabled=VALUES(enabled)",ns,id,value.gatewayId(),value.enabled());
        var saved=terminal(ns,id,false);
        if(!saved.gatewayId().equals(value.gatewayId())) throw WorkflowException.conflict("terminal cannot be reassigned; register a new terminal");
        return saved;
    }
    public Terminal terminal(String ns,String id,boolean lock) {
        return one(jdbc.query("SELECT * FROM edge_terminal WHERE namespace=? AND id=?"+(lock?" FOR UPDATE":""),this::terminal,ns,id),"terminal");
    }
    public List<Terminal> terminals(String ns,int limit,int offset) {
        return jdbc.query("SELECT * FROM edge_terminal WHERE namespace=? ORDER BY id LIMIT ? OFFSET ?",this::terminal,ns,limit,offset);
    }
    public Terminal terminalHeartbeat(String ns,String id) {
        jdbc.update("UPDATE edge_terminal SET last_seen_at=CURRENT_TIMESTAMP(6) WHERE namespace=? AND id=?",ns,id);
        return terminal(ns,id,false);
    }
    public Policy putPolicy(String ns,String id,PolicyRequest value) {
        // Lock a stable policy row before publishing its Flow revision. A unique event route has one owner.
        jdbc.update("INSERT INTO edge_policy(namespace,id,cluster_id,event_type,enabled) VALUES(?,?,?,?,?) ON DUPLICATE KEY UPDATE id=id",ns,id,value.clusterId(),value.eventType(),value.enabled());
        var rows=jdbc.query("SELECT * FROM edge_policy WHERE namespace=? AND id=? FOR UPDATE",this::policy,ns,id);
        if(rows.isEmpty()) throw WorkflowException.conflict("event route already belongs to another policy");
        var saved=rows.getFirst();
        if(!saved.clusterId().equals(value.clusterId()) || !saved.eventType().equals(value.eventType()))
            throw WorkflowException.conflict("policy cluster/event route is immutable; register a new policy");
        jdbc.update("UPDATE edge_policy SET enabled=? WHERE namespace=? AND id=?",value.enabled(),ns,id);
        return policy(ns,id);
    }
    public Policy policy(String ns,String id) {
        return one(jdbc.query("SELECT * FROM edge_policy WHERE namespace=? AND id=?",this::policy,ns,id),"policy");
    }
    public Policy matchingPolicy(String ns,String cluster,String event) {
        return one(jdbc.query("SELECT * FROM edge_policy WHERE namespace=? AND cluster_id=? AND event_type=? FOR UPDATE",this::policy,ns,cluster,event),"matching policy");
    }
    public List<Policy> policies(String ns,int limit,int offset) {
        return jdbc.query("SELECT * FROM edge_policy WHERE namespace=? ORDER BY id LIMIT ? OFFSET ?",this::policy,ns,limit,offset);
    }
    public Receipt receipt(String ns,String terminal,String key) {
        var rows=jdbc.query("SELECT request_hash,execution_id FROM edge_submission WHERE namespace=? AND terminal_id=? AND request_key=?",(rs,row)->new Receipt(rs.getString(1),rs.getString(2)),ns,terminal,key);
        return rows.isEmpty()?null:rows.getFirst();
    }
    public void record(String ns,String terminal,String key,String hash,String execution) {
        jdbc.update("INSERT INTO edge_submission(namespace,terminal_id,request_key,request_hash,execution_id) VALUES(?,?,?,?,?)",ns,terminal,key,hash,execution);
    }
    public void requireExecution(String ns,String terminal,String execution) {
        if(jdbc.queryForObject("SELECT COUNT(*) FROM edge_submission WHERE namespace=? AND terminal_id=? AND execution_id=?",Integer.class,ns,terminal,execution)==0)
            throw WorkflowException.missing("terminal execution not found");
    }
    public Origin executionOrigin(String ns,String execution,String principal) {
        return one(jdbc.query("""
                SELECT s.terminal_id,g.cluster_id FROM edge_submission s
                JOIN edge_terminal t ON t.namespace=s.namespace AND t.id=s.terminal_id
                JOIN edge_gateway g ON g.namespace=t.namespace AND g.id=t.gateway_id
                WHERE s.namespace=? AND s.execution_id=? AND g.principal=?
                """,(rs,row)->new Origin(rs.getString(1),rs.getString(2)),ns,execution,principal),"gateway execution");
    }
    private Gateway gateway(ResultSet rs,int row) throws SQLException { return new Gateway(rs.getString("id"),rs.getString("cluster_id"),rs.getString("principal"),rs.getBoolean("enabled"),seen(rs)); }
    private Terminal terminal(ResultSet rs,int row) throws SQLException { return new Terminal(rs.getString("id"),rs.getString("gateway_id"),rs.getBoolean("enabled"),seen(rs)); }
    private Policy policy(ResultSet rs,int row) throws SQLException { return new Policy(rs.getString("id"),rs.getString("cluster_id"),rs.getString("event_type"),rs.getBoolean("enabled")); }
    private Instant seen(ResultSet rs) throws SQLException { var value=rs.getTimestamp("last_seen_at");return value==null?null:value.toInstant(); }
    private static <T>T one(List<T> rows,String kind) { if(rows.isEmpty()) throw WorkflowException.missing(kind+" not found");return rows.getFirst(); }
}
