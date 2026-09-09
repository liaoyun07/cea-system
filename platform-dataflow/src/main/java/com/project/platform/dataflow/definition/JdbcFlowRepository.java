package com.project.platform.dataflow.definition;

import com.project.platform.runtime.definition.JsonCodec;
import com.project.platform.runtime.model.FlowDefinition;
import com.project.platform.runtime.model.WorkflowException;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Clock;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionTemplate;

public final class JdbcFlowRepository {
    private final JdbcTemplate jdbc;
    private final TransactionTemplate transactions;
    private final JsonCodec json;
    private final Clock clock;

    public JdbcFlowRepository(JdbcTemplate jdbc, TransactionTemplate transactions, JsonCodec json, Clock clock) {
        this.jdbc = jdbc; this.transactions = transactions; this.json = json; this.clock = clock;
    }

    public FlowRevision save(FlowDefinition flow, String source, int expectedRevision, String actor) {
        return transactions.execute(status -> {
            // Lock the stable head even on first creation. No count-then-insert race.
            jdbc.update("INSERT INTO wf_flow_head(namespace,flow_id,latest_revision) VALUES(?,?,0) ON DUPLICATE KEY UPDATE flow_id=flow_id",
                    flow.namespace(), flow.id());
            Integer latest = jdbc.queryForObject(
                    "SELECT latest_revision FROM wf_flow_head WHERE namespace=? AND flow_id=? FOR UPDATE",
                    Integer.class, flow.namespace(), flow.id());
            if (latest != expectedRevision) throw WorkflowException.conflict("expectedRevision does not match latest revision");
            int revision = latest + 1;
            var now = clock.instant();
            jdbc.update("""
                    INSERT INTO wf_flow_revision(namespace,flow_id,revision,source_text,definition_json,created_by,created_at)
                    VALUES(?,?,?,?,?,?,?)
                    """, flow.namespace(), flow.id(), revision, source, json.write(flow), actor, Timestamp.from(now));
            jdbc.update("UPDATE wf_flow_head SET latest_revision=? WHERE namespace=? AND flow_id=?",
                    revision, flow.namespace(), flow.id());
            return new FlowRevision(flow.namespace(), flow.id(), revision, source, flow, actor, now);
        });
    }

    public FlowRevision get(String namespace, String flowId, Integer revision) {
        String sql = revision == null
                ? "SELECT r.* FROM wf_flow_revision r JOIN wf_flow_head h ON r.namespace=h.namespace AND r.flow_id=h.flow_id AND r.revision=h.latest_revision WHERE r.namespace=? AND r.flow_id=?"
                : "SELECT * FROM wf_flow_revision WHERE namespace=? AND flow_id=? AND revision=?";
        List<FlowRevision> rows = revision == null ? jdbc.query(sql, this::revision, namespace, flowId)
                : jdbc.query(sql, this::revision, namespace, flowId, revision);
        if (rows.isEmpty()) throw WorkflowException.missing("flow revision not found");
        return rows.getFirst();
    }

    public List<FlowRevision.Summary> history(String namespace, String flowId, int limit, int offset) {
        return jdbc.query("SELECT * FROM wf_flow_revision WHERE namespace=? AND flow_id=? ORDER BY revision DESC LIMIT ? OFFSET ?",
                (rs, row) -> new FlowRevision.Summary(namespace, flowId, rs.getInt("revision"),
                        rs.getString("created_by"), rs.getTimestamp("created_at").toInstant()), namespace, flowId, limit, offset);
    }

    public List<FlowRevision.Summary> list(String namespace, int limit, int offset) {
        return jdbc.query("""
                SELECT r.* FROM wf_flow_head h JOIN wf_flow_revision r
                ON h.namespace=r.namespace AND h.flow_id=r.flow_id AND h.latest_revision=r.revision
                WHERE h.namespace=? ORDER BY h.flow_id LIMIT ? OFFSET ?
                """, (rs,row) -> new FlowRevision.Summary(namespace, rs.getString("flow_id"), rs.getInt("revision"),
                rs.getString("created_by"), rs.getTimestamp("created_at").toInstant()), namespace, limit, offset);
    }

    private FlowRevision revision(ResultSet rs, int row) throws SQLException {
        return new FlowRevision(rs.getString("namespace"), rs.getString("flow_id"), rs.getInt("revision"),
                rs.getString("source_text"), json.flow(rs.getString("definition_json")), rs.getString("created_by"), rs.getTimestamp("created_at").toInstant());
    }
}
