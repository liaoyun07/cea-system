package com.project.platform.runtime.model;

import java.time.Instant;
import java.util.Map;

public record ExecutionRecord(
        String id, String namespace, String flowId, int flowRevision, String submittedBy,
        ExecutionState state, FlowDefinition definition,
        Map<String,Object> inputs, Map<String,Object> variables, Map<String,Object> outputs,
        Instant createdAt, Instant startedAt, Instant endedAt, String error,
        ExecutionState mainState, String cleanupError) {
    public record TaskRun(String id, String executionId, String taskId, int taskIndex,
                          ExecutionState state, Map<String,Object> outputs,
                          Instant startedAt, Instant endedAt, String error,
                          FlowDefinition.Phase phase, Instant retryAt,String parentTaskRunId,int iteration) {}
    public record Attempt(String taskRunId, int attemptNo, ExecutionState state,
                          Instant startedAt, Instant endedAt, String error) {}
    public record LogEntry(long id, String executionId, String taskRunId, int attemptNo,
                           String level, String message, Instant at) {}
    public record Submission(String id, String requestHash) {}
}
