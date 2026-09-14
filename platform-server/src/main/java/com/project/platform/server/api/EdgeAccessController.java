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
    private final com.project.platform.offloading.OffloadingService offloading;
    public EdgeAccessController(EdgeAccessService edge,IdentityDirectory identities,com.project.platform.dataflow.execution.ExecutionOutputService outputs,com.project.platform.offloading.OffloadingService offloading) { this.edge=edge;this.identities=identities;this.outputs=outputs;this.offloading=offloading; }
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
    @PostMapping("/terminals/{id}/executions/{executionId}/feedback")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void feedback(Principal p,@PathVariable String namespace,@PathVariable String id,@PathVariable String executionId,
            @RequestBody com.project.platform.offloading.OffloadingService.Feedback feedback) {
        var actor=identities.actor(p.getName());
        var execution=edge.result(actor,namespace,id,executionId); // CONNECT and original terminal/receipt ownership.
        String state=execution.state().name();
        String outcome=feedback.outcome();
        boolean matches=outcome!=null && switch(outcome) {
            case "SUCCESS"->state.equals("SUCCESS");
            case "FAILED"->state.equals("FAILED");
            case "CANCELLED"->state.equals("KILLED");
            case "TIMEOUT"->true; // A client deadline is not confirmation that the remote container stopped.
            case "UNMEASURED"->java.util.Set.of("SUCCESS","FAILED","KILLED").contains(state);
            default->false;
        };
        if(!matches)throw com.project.platform.runtime.model.WorkflowException.invalid("feedback","feedback does not match the actual execution");
        if("SUCCESS".equals(outcome))edge.terminalResult(actor,namespace,id,executionId,outputs);
        offloading.feedback(namespace,executionId,id,feedback);
    }
}
