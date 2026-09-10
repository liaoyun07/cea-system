package com.project.platform.server.api;

import com.project.platform.dataflow.definition.FlowRevision;
import com.project.platform.dataflow.definition.FlowService;
import com.project.platform.server.security.IdentityDirectory;
import java.security.Principal;
import java.util.List;
import java.util.Map;
import com.project.platform.runtime.model.FlowDefinition;
import org.springframework.http.ResponseEntity;
import org.springframework.http.MediaType;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/namespaces/{namespace}/flows")
public final class FlowController {
    public record SaveRequest(Integer expectedRevision, String source) {}
    public record RollbackRequest(Integer expectedRevision, int targetRevision) {}
    public record SourceRequest(String source) {}
    public record PreviewRequest(String source,Map<String,Object> inputs) {}
    public record ImportRequest(List<FlowService.ImportEntry> flows) {}
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
                                          @RequestParam(required=false) String q,@RequestParam(required=false) String labelKey,@RequestParam(required=false) String labelValue,
                                          @RequestParam(defaultValue = "20") int limit, @RequestParam(defaultValue = "0") int offset) {
        return flows.search(identities.actor(principal.getName()),namespace,q,labelKey,labelValue,limit,offset);
    }
    @GetMapping("/editor/schema")
    public Map<String,Object> schema(Principal principal,@PathVariable String namespace) {
        return flows.schema(identities.actor(principal.getName()),namespace);
    }
    @PostMapping("/{flowId}/validate")
    public FlowDefinition validate(Principal principal,@PathVariable String namespace,@PathVariable String flowId,@RequestBody SourceRequest request) {
        return flows.validate(identities.actor(principal.getName()),namespace,flowId,request.source());
    }
    @PostMapping("/{flowId}/preview")
    public FlowService.Preview preview(Principal principal,@PathVariable String namespace,@PathVariable String flowId,@RequestBody PreviewRequest request) {
        return flows.preview(identities.actor(principal.getName()),namespace,flowId,request.source(),request.inputs());
    }
    @GetMapping("/{flowId}/export")
    public ResponseEntity<String> export(Principal principal,@PathVariable String namespace,@PathVariable String flowId,
                                         @RequestParam(required=false) Integer revision,@RequestParam(defaultValue="source") String format) {
        String source=flows.export(identities.actor(principal.getName()),namespace,flowId,revision,format);
        var contentType=switch(format) {case "json"->MediaType.APPLICATION_JSON;case "yaml"->MediaType.parseMediaType("application/yaml");default->MediaType.TEXT_PLAIN;};
        return ResponseEntity.ok().contentType(contentType).body(source);
    }
    @PostMapping("/import")
    @ResponseStatus(HttpStatus.CREATED)
    public List<FlowRevision> importFlows(Principal principal,@PathVariable String namespace,@RequestBody ImportRequest request) {
        return flows.importFlows(identities.actor(principal.getName()),namespace,request.flows());
    }
}
