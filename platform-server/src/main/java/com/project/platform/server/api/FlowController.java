package com.project.platform.server.api;

import com.project.platform.dataflow.definition.FlowRevision;
import com.project.platform.dataflow.definition.FlowService;
import com.project.platform.server.security.IdentityDirectory;
import java.security.Principal;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/namespaces/{namespace}/flows")
public final class FlowController {
    public record SaveRequest(Integer expectedRevision, String source) {}
    public record RollbackRequest(Integer expectedRevision, int targetRevision) {}
    private final FlowService flows;
    private final IdentityDirectory identities;
    public FlowController(FlowService flows, IdentityDirectory identities) { this.flows = flows; this.identities = identities; }

    @PostMapping("/{flowId}/revisions")
    @ResponseStatus(HttpStatus.CREATED)
    public FlowRevision save(Principal principal, @PathVariable String namespace, @PathVariable String flowId, @RequestBody SaveRequest request) {
        return flows.save(identities.actor(principal.getName()), namespace, flowId, request.expectedRevision(), request.source());
    }
    @GetMapping("/{flowId}")
    public FlowRevision get(Principal principal, @PathVariable String namespace, @PathVariable String flowId,
                            @RequestParam(required = false) Integer revision) {
        return flows.get(identities.actor(principal.getName()), namespace, flowId, revision);
    }
    @GetMapping("/{flowId}/revisions")
    public List<FlowRevision.Summary> revisions(Principal principal, @PathVariable String namespace, @PathVariable String flowId,
                                               @RequestParam(defaultValue = "20") int limit, @RequestParam(defaultValue = "0") int offset) {
        return flows.history(identities.actor(principal.getName()), namespace, flowId, limit, offset);
    }
    @PostMapping("/{flowId}/rollback")
    @ResponseStatus(HttpStatus.CREATED)
    public FlowRevision rollback(Principal principal, @PathVariable String namespace, @PathVariable String flowId,
                                 @RequestBody RollbackRequest request) {
        return flows.rollback(identities.actor(principal.getName()), namespace, flowId, request.expectedRevision(), request.targetRevision());
    }
    @GetMapping
    public List<FlowRevision.Summary> list(Principal principal, @PathVariable String namespace,
                                          @RequestParam(defaultValue = "20") int limit, @RequestParam(defaultValue = "0") int offset) {
        return flows.list(identities.actor(principal.getName()), namespace, limit, offset);
    }
}

