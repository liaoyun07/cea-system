package com.project.platform.server.api;

import com.project.platform.deployment.service.DeploymentService;
import com.project.platform.server.security.IdentityDirectory;
import java.security.Principal;
import java.util.List;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/namespaces/{namespace}/clusters/{clusterId}/deployments")
public final class DeploymentController {
    private final DeploymentService deployments;
    private final IdentityDirectory identities;
    public DeploymentController(DeploymentService deployments,IdentityDirectory identities) { this.deployments=deployments;this.identities=identities; }
    @PutMapping("/{name}")
    public DeploymentService.View put(Principal principal,@PathVariable String namespace,@PathVariable String clusterId,@PathVariable String name,@RequestBody DeploymentService.Request request) {
        return deployments.put(identities.actor(principal.getName()),namespace,clusterId,name,request);
    }
    @GetMapping("/{name}")
    public DeploymentService.View get(Principal principal,@PathVariable String namespace,@PathVariable String clusterId,@PathVariable String name) {
        return deployments.get(identities.actor(principal.getName()),namespace,clusterId,name);
    }
    @GetMapping("/{name}/configuration")
    public DeploymentService.Configuration configuration(Principal principal,@PathVariable String namespace,@PathVariable String clusterId,@PathVariable String name) {
        return deployments.configuration(identities.actor(principal.getName()),namespace,clusterId,name);
    }
    @GetMapping("/{name}/runtime")
    public DeploymentService.RuntimeView runtime(Principal principal,@PathVariable String namespace,@PathVariable String clusterId,@PathVariable String name) {
        return deployments.runtime(identities.actor(principal.getName()),namespace,clusterId,name);
    }
    @PatchMapping("/{name}/scale")
    public DeploymentService.View scale(Principal principal,@PathVariable String namespace,@PathVariable String clusterId,@PathVariable String name,@RequestBody DeploymentService.ScaleRequest request) {
        return deployments.scale(identities.actor(principal.getName()),namespace,clusterId,name,request);
    }
    @GetMapping("/{name}/history")
    public List<DeploymentService.DeploymentRecord> history(Principal principal,@PathVariable String namespace,@PathVariable String clusterId,@PathVariable String name,
            @RequestParam(defaultValue="20") int limit,@RequestParam(defaultValue="0") int offset) {
        return deployments.history(identities.actor(principal.getName()),namespace,clusterId,name,limit,offset);
    }
    @GetMapping
    public List<DeploymentService.View> list(Principal principal,@PathVariable String namespace,@PathVariable String clusterId) {
        return deployments.list(identities.actor(principal.getName()),namespace,clusterId);
    }
    @DeleteMapping("/{name}")
    public ResponseEntity<Void> delete(Principal principal,@PathVariable String namespace,@PathVariable String clusterId,@PathVariable String name,@RequestParam String resourceVersion) {
        deployments.delete(identities.actor(principal.getName()),namespace,clusterId,name,resourceVersion);return ResponseEntity.accepted().build();
    }
}
