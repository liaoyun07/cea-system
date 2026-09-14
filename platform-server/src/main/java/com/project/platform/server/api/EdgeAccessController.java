package com.project.platform.server.api;

import com.project.platform.edge.EdgeAccess.*;
import com.project.platform.edge.EdgeAccessService;
import com.project.platform.dataflow.execution.FlowExecutionService;
import com.project.platform.server.security.IdentityDirectory;
import java.security.Principal;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/namespaces/{namespace}/edge-access")
public final class EdgeAccessController {
    private final EdgeAccessService edge;
    private final IdentityDirectory identities;
    private final com.project.platform.dataflow.execution.ExecutionOutputService outputs;
    public EdgeAccessController(EdgeAccessService edge,IdentityDirectory identities,com.project.platform.dataflow.execution.ExecutionOutputService outputs) { this.edge=edge;this.identities=identities;this.outputs=outputs; }
    @PostMapping("/heartbeat")
    public Gateway heartbeat(Principal p,@PathVariable String namespace) { return edge.heartbeat(identities.actor(p.getName()),namespace); }
    @PostMapping("/terminals/{id}/heartbeat")
    public Terminal heartbeat(Principal p,@PathVariable String namespace,@PathVariable String id) { return edge.terminalHeartbeat(identities.actor(p.getName()),namespace,id); }
    @PostMapping("/terminals/{id}/executions")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public ExecutionController.Accepted submit(Principal p,@PathVariable String namespace,@PathVariable String id,
            @RequestHeader("Idempotency-Key") String key,@RequestBody FlowExecutionService.Request request) {
        return new ExecutionController.Accepted(edge.submit(identities.actor(p.getName()),namespace,id,key,request));
    }
    @PostMapping("/terminals/{id}/events")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public ExecutionController.Accepted event(Principal p,@PathVariable String namespace,@PathVariable String id,
            @RequestHeader("Idempotency-Key") String key,@RequestBody Event request) {
        return new ExecutionController.Accepted(edge.event(identities.actor(p.getName()),namespace,id,key,request));
    }
    @GetMapping("/terminals/{id}/executions/{executionId}")
    public ExecutionController.View result(Principal p,@PathVariable String namespace,@PathVariable String id,@PathVariable String executionId) {
        return ExecutionController.View.of(edge.result(identities.actor(p.getName()),namespace,id,executionId));
    }
    @GetMapping("/terminals/{id}/executions/{executionId}/result")
    public java.util.Map<?,?> terminalResult(Principal p,@PathVariable String namespace,@PathVariable String id,@PathVariable String executionId) {
        return edge.terminalResult(identities.actor(p.getName()),namespace,id,executionId,outputs);
    }
}
