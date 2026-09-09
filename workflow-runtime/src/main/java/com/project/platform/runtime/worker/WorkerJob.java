package com.project.platform.runtime.worker;

import com.project.platform.runtime.model.FlowDefinition.Task;
import java.util.Map;

/** The internal shared-database message contract, not a public unauthenticated Worker API. */
public record WorkerJob(String executionId, String taskRunId, int attemptNo, Task task, Map<String,Object> context) {
    public record Lease(WorkerJob job, long epoch, String owner) {}
    public record Result(boolean success, Map<String,Object> outputs, String error) {
        public static Result success(Map<String,Object> outputs) { return new Result(true,outputs,null); }
        public static Result failed(String error) { return new Result(false,Map.of(),error); }
    }
}
