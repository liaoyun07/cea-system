package com.project.platform.server.api;

import com.project.platform.dataflow.execution.FlowExecutionService;
import com.project.platform.runtime.model.ExecutionRecord;
import com.project.platform.runtime.model.ExecutionState;
import com.project.platform.server.security.IdentityDirectory;
import java.security.Principal;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/namespaces/{namespace}/executions")
public final class ExecutionController {
    public record Accepted(String executionId) {}
    public record View(String id, String namespace, String flowId, int flowRevision, String submittedBy,
                       ExecutionState state, Map<String,Object> inputs, Map<String,Object> variables,
                       Map<String,Object> outputs, Instant createdAt, Instant startedAt, Instant endedAt, String error,
                       ExecutionState mainState, String cleanupError, Instant slaViolatedAt) {
        static View of(ExecutionRecord e) {
            return new View(e.id(),e.namespace(),e.flowId(),e.flowRevision(),e.submittedBy(),e.state(),
                    e.inputs(),e.variables(),e.outputs(),e.createdAt(),e.startedAt(),e.endedAt(),e.error(),e.mainState(),e.cleanupError(),e.slaViolatedAt());
        }
    }
    private final FlowExecutionService executions;
    private final IdentityDirectory identities;
    private final com.project.platform.dataflow.execution.ExecutionOutputService outputs;
    public ExecutionController(FlowExecutionService executions, IdentityDirectory identities,com.project.platform.dataflow.execution.ExecutionOutputService outputs) {
        this.executions = executions; this.identities = identities; this.outputs=outputs;
    }
    @PostMapping
    @ResponseStatus(HttpStatus.ACCEPTED)
    public Accepted submit(Principal principal, @PathVariable String namespace,
                           @RequestHeader("Idempotency-Key") String key, @RequestBody FlowExecutionService.Request request) {
        return new Accepted(executions.submit(identities.actor(principal.getName()), namespace, key, request));
    }
    @GetMapping("/{id}")
    public View get(Principal principal, @PathVariable String namespace, @PathVariable String id) {
        return View.of(executions.get(identities.actor(principal.getName()), namespace, id));
    }
    @PostMapping("/{id}/cancel")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public Accepted cancel(Principal principal,@PathVariable String namespace,@PathVariable String id) {
        executions.cancel(identities.actor(principal.getName()),namespace,id);
        return new Accepted(id);
    }
    @GetMapping
    public List<View> list(Principal principal, @PathVariable String namespace,
                          @RequestParam(defaultValue="20") int limit, @RequestParam(defaultValue="0") int offset) {
        return executions.list(identities.actor(principal.getName()), namespace, limit, offset).stream().map(View::of).toList();
    }
    @GetMapping("/{id}/tasks")
    public List<ExecutionRecord.TaskRun> tasks(Principal principal, @PathVariable String namespace, @PathVariable String id) {
        return executions.tasks(identities.actor(principal.getName()), namespace, id);
    }
    @GetMapping("/{id}/tasks/{taskRunId}/attempts")
    public List<ExecutionRecord.Attempt> attempts(Principal principal, @PathVariable String namespace, @PathVariable String id,
                                                @PathVariable String taskRunId) {
        return executions.attempts(identities.actor(principal.getName()), namespace, id, taskRunId);
    }
    @GetMapping("/{id}/logs")
    public List<ExecutionRecord.LogEntry> logs(Principal principal, @PathVariable String namespace, @PathVariable String id,
                                              @RequestParam(defaultValue="0") long afterId, @RequestParam(defaultValue="50") int limit) {
        return executions.logs(identities.actor(principal.getName()), namespace, id, afterId, limit);
    }
    @GetMapping("/{id}/tasks/{taskRunId}/output-json")
    public Map<?,?> outputJson(Principal principal,@PathVariable String namespace,@PathVariable String id,@PathVariable String taskRunId,@RequestParam String port) {
        return outputs.readJson(identities.actor(principal.getName()),namespace,id,taskRunId,port);
    }
}
