package com.project.platform.deployment.service;

import org.springframework.jdbc.core.JdbcTemplate;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.*;
import com.project.platform.deployment.service.DeploymentWorkloads.Scope;

/** Append-only observations and event completion; never writes Kubernetes desired state. */
public final class JdbcScalingRepository {
    public record Sample(Instant at,int desired,int ready,int standby) {}
    public record Event(String id,Instant startedAt,Instant finishedAt,int fromReplicas,int toReplicas,String state,Long durationMs,Integer warmHits) {}
    public record History(List<Sample> samples,List<Event> events) {}
    private final JdbcTemplate jdbc;
    public JdbcScalingRepository(JdbcTemplate jdbc) { this.jdbc=jdbc; }
    public void interrupted() { jdbc.update("UPDATE dep_scaling_event SET state='INTERRUPTED' WHERE state='OBSERVING'"); }
    public void sample(Scope scope,String name,String uid,Sample value) {
        jdbc.update("INSERT INTO dep_replica_sample(namespace,cluster_id,kube_namespace,deployment_name,workload_uid,observed_at,desired,ready,standby) VALUES(?,?,?,?,?,?,?,?,?)",
                scope.namespace(),scope.clusterId(),scope.kubeNamespace(),name,uid,Timestamp.from(value.at()),value.desired(),value.ready(),value.standby());
    }
    public String begin(Scope scope,String name,String uid,Instant at,int from,int to,String baseline,String standby) {
        String id=UUID.randomUUID().toString();
        jdbc.update("INSERT INTO dep_scaling_event(id,namespace,cluster_id,kube_namespace,deployment_name,workload_uid,started_at,from_replicas,to_replicas,state,baseline_pods,standby_pods) VALUES(?,?,?,?,?,?,?,?,?,'OBSERVING',?,?)",
                id,scope.namespace(),scope.clusterId(),scope.kubeNamespace(),name,uid,Timestamp.from(at),from,to,baseline,standby);return id;
    }
    public void finish(String id,Instant at,String state,Long duration,Integer hits,String pods) {
        jdbc.update("UPDATE dep_scaling_event SET finished_at=?,state=?,duration_ms=?,warm_hits=?,end_pods=? WHERE id=? AND state='OBSERVING'",
                Timestamp.from(at),state,duration,hits,pods,id);
    }
    public History history(Scope scope,String name,String uid,Instant since) {
        var samples=jdbc.query("SELECT observed_at,desired,ready,standby FROM dep_replica_sample WHERE namespace=? AND cluster_id=? AND kube_namespace=? AND deployment_name=? AND workload_uid=? AND observed_at>=? ORDER BY observed_at DESC,id DESC LIMIT 4000",
                (rs,n)->new Sample(rs.getTimestamp(1).toInstant(),rs.getInt(2),rs.getInt(3),rs.getInt(4)),scope.namespace(),scope.clusterId(),scope.kubeNamespace(),name,uid,Timestamp.from(since));
        Collections.reverse(samples);
        var events=jdbc.query("SELECT * FROM dep_scaling_event WHERE namespace=? AND cluster_id=? AND kube_namespace=? AND deployment_name=? AND workload_uid=? AND started_at>=? ORDER BY started_at DESC,id DESC LIMIT 500",
                (rs,n)->new Event(rs.getString("id"),rs.getTimestamp("started_at").toInstant(),rs.getTimestamp("finished_at")==null?null:rs.getTimestamp("finished_at").toInstant(),
                        rs.getInt("from_replicas"),rs.getInt("to_replicas"),rs.getString("state"),(Long)rs.getObject("duration_ms"),(Integer)rs.getObject("warm_hits")),
                scope.namespace(),scope.clusterId(),scope.kubeNamespace(),name,uid,Timestamp.from(since));
        return new History(samples,events);
    }
}
