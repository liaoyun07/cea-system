package com.project.platform.runtime.persistence;

import com.project.platform.runtime.definition.JsonCodec;
import com.project.platform.runtime.model.FlowDefinition;
import com.project.platform.runtime.scheduler.ScheduleCalculator;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Objects;
import org.springframework.jdbc.core.JdbcTemplate;

/** Schedule cursor and immutable submission payload; callers hold the Flow lock. */
public final class JdbcScheduleStore {
    public record ScheduledFlow(FlowDefinition flow,int revision,String actor) {}
    public record Due(String namespace,String flowId,Instant at,ScheduledFlow payload) {}
    private final JdbcTemplate jdbc;
    private final JsonCodec json;
    public JdbcScheduleStore(JdbcTemplate jdbc,JsonCodec json) { this.jdbc=jdbc;this.json=json; }
    public void configure(FlowDefinition flow,int revision,String actor,Instant now) {
        if(flow.schedule()==null) {
            jdbc.update("DELETE FROM wf_schedule WHERE namespace=? AND flow_id=?",flow.namespace(),flow.id()); return;
        }
        var old=jdbc.query("SELECT payload_json,next_fire FROM wf_schedule WHERE namespace=? AND flow_id=? FOR UPDATE",
                (rs,row)->new Due(flow.namespace(),flow.id(),rs.getTimestamp(2)==null?null:rs.getTimestamp(2).toInstant(),json.read(rs.getString(1),ScheduledFlow.class)),flow.namespace(),flow.id());
        Instant next=flow.schedule().disabled()?null:ScheduleCalculator.next(flow.schedule(),now);
        if(!old.isEmpty() && Objects.equals(old.getFirst().payload().flow().schedule(),flow.schedule())) next=old.getFirst().at();
        jdbc.update("""
                INSERT INTO wf_schedule(namespace,flow_id,payload_json,next_fire) VALUES(?,?,?,?)
                ON DUPLICATE KEY UPDATE payload_json=VALUES(payload_json),next_fire=VALUES(next_fire)
                """,flow.namespace(),flow.id(),json.write(new ScheduledFlow(flow,revision,actor)),next==null?null:Timestamp.from(next));
    }
    public Due peek() {
        var rows=jdbc.query("SELECT namespace,flow_id,next_fire FROM wf_schedule WHERE next_fire<=CURRENT_TIMESTAMP(6) ORDER BY next_fire,namespace,flow_id LIMIT 1",
                (rs,row)->new Due(rs.getString(1),rs.getString(2),rs.getTimestamp(3).toInstant(),null));
        return rows.isEmpty()?null:rows.getFirst();
    }
    public void remove(String namespace,String flowId) { jdbc.update("DELETE FROM wf_schedule WHERE namespace=? AND flow_id=?",namespace,flowId); }
    public Due lockDue(Due candidate) {
        var rows=jdbc.query("SELECT payload_json,next_fire FROM wf_schedule WHERE namespace=? AND flow_id=? AND next_fire<=CURRENT_TIMESTAMP(6) FOR UPDATE",
                (rs,row)->new Due(candidate.namespace(),candidate.flowId(),rs.getTimestamp(2).toInstant(),json.read(rs.getString(1),ScheduledFlow.class)),candidate.namespace(),candidate.flowId());
        return rows.isEmpty()?null:rows.getFirst();
    }
    public void advance(Due due,Instant next) {
        jdbc.update("UPDATE wf_schedule SET next_fire=? WHERE namespace=? AND flow_id=?",next==null?null:Timestamp.from(next),due.namespace(),due.flowId());
    }
}
