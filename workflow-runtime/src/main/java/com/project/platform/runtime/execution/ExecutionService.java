package com.project.platform.runtime.execution;

import com.project.platform.runtime.definition.BindingResolver;
import com.project.platform.runtime.model.*;
import com.project.platform.runtime.model.ExecutionRecord.*;
import com.project.platform.runtime.persistence.JdbcExecutionStore;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.dao.DuplicateKeyException;

/** Internal API. Namespace authorization is performed by the application facade. */
public final class ExecutionService {
    private final JdbcExecutionStore store;
    public ExecutionService(JdbcExecutionStore store) { this.store = store; }

    public String findSubmission(String namespace, String actor, String key, String hash) {
        if (key == null || key.isBlank() || key.length() > 128) throw WorkflowException.invalid("requestKey", "requires 1..128 characters");
        Submission existing = store.findSubmission(namespace, actor, key);
        if (existing == null) return null;
        if (!existing.requestHash().equals(hash)) throw WorkflowException.conflict("requestKey already used with different content");
        return existing.id();
    }

    public String submit(FlowDefinition flow, int revision, String actor, String key, String hash, BindingResolver.Prepared prepared) {
        String existing = findSubmission(flow.namespace(), actor, key, hash);
        if (existing != null) return existing;
        new BindingResolver().checks(flow,prepared);
        String id = UUID.randomUUID().toString();
        try {
            store.transaction(() -> {
                store.lockFlow(flow.namespace(),flow.id());
                var execution = new ExecutionRecord(id, flow.namespace(), flow.id(), revision, actor, store.admission(flow.namespace(),flow.id()),
                        flow, prepared.inputs(), prepared.variables(), Map.of(), store.now(), null, null, null, null, null, null);
                store.create(execution, key, hash); return id;
            });
            return id;
        } catch (DuplicateKeyException ex) {
            String concurrent = findSubmission(flow.namespace(), actor, key, hash);
            if (concurrent == null) throw ex;
            return concurrent;
        }
    }

    public <T>T transaction(java.util.function.Supplier<T> work) { return store.transaction(work); }
    public void configureConcurrency(FlowDefinition flow) { store.configureConcurrency(flow); }

    public ExecutionRecord get(String namespace, String id) { return store.get(namespace, id); }
    public record DayCount(String date, ExecutionState state, long count) {}
    public record Recent(String id, String flowId, ExecutionState state, java.time.Instant createdAt) {}
    public record Overview(java.time.Instant from, java.time.Instant to, List<DayCount> days, List<Recent> recent) {}
    public Overview overview(String namespace, int days) {
        if (days < 1 || days > 31) throw WorkflowException.invalid("days", "must be 1..31");
        return store.overview(namespace, days);
    }
    public void cancel(String namespace, String id) { store.requestCancel(namespace,id); }
    public List<ExecutionRecord> list(String namespace, int limit, int offset) {
        page(limit, offset);
        return store.list(namespace, limit, offset);
    }
    public List<TaskRun> tasks(String namespace, String id) {
        store.get(namespace, id);
        return store.tasks(id);
    }
    public List<Attempt> attempts(String namespace, String id, String taskRunId) {
        if (tasks(namespace, id).stream().noneMatch(t -> t.id().equals(taskRunId))) throw WorkflowException.missing("task run not found");
        return store.attempts(taskRunId);
    }
    public List<LogEntry> logs(String namespace, String id, long afterId, int limit) {
        page(limit, 0);
        if (afterId < 0) throw WorkflowException.invalid("afterId", "must not be negative");
        store.get(namespace, id);
        return store.logs(id, afterId, limit);
    }
    public static void page(int limit, int offset) {
        if (limit < 1 || limit > 100 || offset < 0 || offset > 1_000_000) {
            throw WorkflowException.invalid("pagination", "limit 1..100, offset 0..1000000");
        }
    }
}
