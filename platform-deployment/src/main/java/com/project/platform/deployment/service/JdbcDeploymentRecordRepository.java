package com.project.platform.deployment.service;

import com.project.platform.deployment.service.DeploymentService.DeploymentRecord;
import java.sql.*;
import java.time.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;

/** Timing evidence, not a copy of Kubernetes desired state or an executable operation queue. */
public final class JdbcDeploymentRecordRepository {
    public record Observation(String id,String namespace,String clusterId,String kubeNamespace,String name,String uid,Long generation,int replicas,
                              String state,Instant lastObservedAt,Instant deadline) {}
    private final JdbcTemplate jdbc;
    public JdbcDeploymentRecordRepository(JdbcTemplate jdbc) { this.jdbc=jdbc; }
    public void assignLegacyNamespace(String namespace,String cluster,String kubeNamespace) {
        jdbc.update("UPDATE dep_deployment_record SET kube_namespace=? WHERE namespace=? AND cluster_id=? AND kube_namespace IS NULL",kubeNamespace,namespace,cluster);
    }
    public String begin(String namespace,String cluster,String kubeNamespace,String name,String application,String version,String operation,int replicas,Instant now,Instant deadline) {
        String id=UUID.randomUUID().toString();
        jdbc.update("INSERT INTO dep_deployment_record(id,namespace,cluster_id,kube_namespace,deployment_name,application_id,version,operation,target_replicas,state,started_at,last_observed_at,deadline_at,timing_valid) VALUES(?,?,?,?,?,?,?,?,?,'PREPARING',?,?,?,?)",
                id,namespace,cluster,kubeNamespace,name,application,version,operation,replicas,Timestamp.from(now),Timestamp.from(now),Timestamp.from(deadline),replicas>0);
        return id;
    }
    public void submitted(String id,String uid,long generation,Instant now,boolean measurableChange) {
        jdbc.update("UPDATE dep_deployment_record SET target_uid=?,target_generation=?,state='OBSERVING',last_observed_at=?,timing_valid=timing_valid AND ? WHERE id=? AND state='PREPARING'",
                uid,generation,Timestamp.from(now),measurableChange,id);
    }
    public void finish(String id,String state,String error,Instant now,boolean valid) {
        jdbc.update("UPDATE dep_deployment_record SET state=?,error=?,finished_at=?,timing_valid=timing_valid AND ? WHERE id=? AND state IN ('PREPARING','OBSERVING')",
                state,error,Timestamp.from(now),valid,id);
    }
    public void observed(String id,Instant now,boolean continuous) {
        jdbc.update("UPDATE dep_deployment_record SET last_observed_at=?,timing_valid=timing_valid AND ? WHERE id=? AND state='OBSERVING'",Timestamp.from(now),continuous,id);
    }
    public List<Observation> active() {
        return jdbc.query("SELECT * FROM dep_deployment_record WHERE state IN ('PREPARING','OBSERVING') ORDER BY last_observed_at LIMIT 100",
                (rs,row)->new Observation(rs.getString("id"),rs.getString("namespace"),rs.getString("cluster_id"),rs.getString("kube_namespace"),rs.getString("deployment_name"),rs.getString("target_uid"),
                        (Long)rs.getObject("target_generation"),rs.getInt("target_replicas"),rs.getString("state"),rs.getTimestamp("last_observed_at").toInstant(),rs.getTimestamp("deadline_at").toInstant()));
    }
    public List<DeploymentRecord> list(String namespace,String cluster,String kubeNamespace,String name,int limit,int offset) {
        return jdbc.query("SELECT * FROM dep_deployment_record WHERE namespace=? AND cluster_id=? AND kube_namespace=? AND deployment_name=? ORDER BY started_at DESC,id DESC LIMIT ? OFFSET ?",
                (rs,row)->record(rs),namespace,cluster,kubeNamespace,name,limit,offset);
    }
    private DeploymentRecord record(ResultSet rs) throws SQLException {
        Instant start=rs.getTimestamp("started_at").toInstant();
        Instant end=rs.getTimestamp("finished_at")==null?null:rs.getTimestamp("finished_at").toInstant();
        Long duration=end!=null && !end.isBefore(start) && rs.getBoolean("timing_valid") && "SUCCEEDED".equals(rs.getString("state"))?Duration.between(start,end).toMillis():null;
        return new DeploymentRecord(rs.getString("id"),rs.getString("application_id"),rs.getString("version"),rs.getString("operation"),rs.getInt("target_replicas"),rs.getString("state"),start,end,duration,rs.getString("error"));
    }
}
