package com.project.platform.server.api;

import com.project.platform.dataflow.execution.FlowExecutionService;
import com.project.platform.server.security.IdentityDirectory;
import java.security.Principal;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/namespaces/{namespace}/webhooks")
public final class WebhookController {
    private final FlowExecutionService executions;
    private final IdentityDirectory identities;
    public WebhookController(FlowExecutionService executions,IdentityDirectory identities) {this.executions=executions;this.identities=identities;}
    @PostMapping("/{flowId}")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public ExecutionController.Accepted trigger(Principal principal,@PathVariable String namespace,@PathVariable String flowId,
            @RequestHeader("Idempotency-Key") String key,@RequestBody Map<String,Object> inputs) {
        return new ExecutionController.Accepted(executions.webhook(identities.actor(principal.getName()),namespace,flowId,key,inputs));
    }
}
