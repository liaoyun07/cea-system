package com.project.platform.deployment.distribution;

import com.project.platform.deployment.distribution.ImageDistributionService.Distribution;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;

/** Records actual preparation attempts; a record never substitutes for checking a registry. */
public final class JdbcImageDistributionRepository {
    private final JdbcTemplate jdbc;
    public JdbcImageDistributionRepository(JdbcTemplate jdbc) { this.jdbc=jdbc; }
    public String begin(String namespace,String application,String version,String cluster,String actor,String source,Instant now,Instant deadline) {
        String id=UUID.randomUUID().toString();
        jdbc.update("INSERT INTO dep_image_distribution(id,namespace,application_id,version,cluster_id,requested_by,source_image,state,started_at,deadline_at) VALUES(?,?,?,?,?,?,?,'RUNNING',?,?)",
                id,namespace,application,version,cluster,actor,source,Timestamp.from(now),Timestamp.from(deadline));
        return id;
    }
    public void target(String id,String image) {
        jdbc.update("UPDATE dep_image_distribution SET target_image=? WHERE id=?",image,id);
    }
    public void finish(String id,String state,String error,Instant now) {
        jdbc.update("UPDATE dep_image_distribution SET state=?,error=?,finished_at=? WHERE id=? AND state='RUNNING'",state,error,Timestamp.from(now),id);
    }
    public List<Distribution> list(String namespace,String application,String version,int limit,int offset,Instant now) {
        return jdbc.query("SELECT * FROM dep_image_distribution WHERE namespace=? AND application_id=? AND version=? ORDER BY started_at DESC,id DESC LIMIT ? OFFSET ?",
                (rs,row)->new Distribution(rs.getString("id"),rs.getString("application_id"),rs.getString("version"),rs.getString("cluster_id"),rs.getString("requested_by"),
                        rs.getString("source_image"),rs.getString("target_image"),
                        "RUNNING".equals(rs.getString("state")) && now.isAfter(rs.getTimestamp("deadline_at").toInstant())?"UNKNOWN":rs.getString("state"),
                        rs.getTimestamp("started_at").toInstant(),rs.getTimestamp("finished_at")==null?null:rs.getTimestamp("finished_at").toInstant(),rs.getString("error")),
                namespace,application,version,limit,offset);
    }
    public List<String> knownTargets(String namespace) {
        return jdbc.queryForList("SELECT DISTINCT target_image FROM dep_image_distribution WHERE namespace=? AND target_image IS NOT NULL",String.class,namespace);
    }
    public Set<String> applicationReferences(String namespace,String target) {
        return new HashSet<>(jdbc.queryForList("SELECT DISTINCT CONCAT(application_id,'/',version) FROM dep_image_distribution WHERE namespace=? AND target_image=?",String.class,namespace,target));
    }
    public List<String> unfinishedImages(String namespace) {
        return jdbc.queryForList("SELECT source_image FROM dep_image_distribution WHERE namespace=? AND state='RUNNING' UNION SELECT target_image FROM dep_image_distribution WHERE namespace=? AND state='RUNNING' AND target_image IS NOT NULL",String.class,namespace,namespace);
    }
}
