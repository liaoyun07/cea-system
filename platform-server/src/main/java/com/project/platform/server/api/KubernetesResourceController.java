package com.project.platform.server.api;

import com.project.platform.resource.kubernetes.KubernetesResourceService;
import com.project.platform.resource.kubernetes.KubernetesResourceService.*;
import com.project.platform.server.security.IdentityDirectory;
import java.security.Principal;
import java.util.List;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/namespaces/{namespace}/clusters/{cluster}/kubernetes")
public final class KubernetesResourceController {
    private final KubernetesResourceService resources;
    private final IdentityDirectory identities;
    public KubernetesResourceController(KubernetesResourceService resources,IdentityDirectory identities) {
        this.resources=resources;this.identities=identities;
    }
    @GetMapping("/nodes")
    public Page<NodeView> nodes(Principal principal,@PathVariable String namespace,@PathVariable String cluster,
                                @RequestParam(defaultValue="50") int limit,@RequestParam(required=false) String continueToken) {
        return resources.nodes(identities.actor(principal.getName()),namespace,cluster,limit,continueToken);
    }
    @GetMapping("/services")
    public Page<ServiceView> services(Principal principal,@PathVariable String namespace,@PathVariable String cluster,
                                     @RequestParam(defaultValue="50") int limit,@RequestParam(required=false) String continueToken) {
        return resources.services(identities.actor(principal.getName()),namespace,cluster,limit,continueToken);
    }
    @GetMapping("/namespace")
    public NamespaceView namespace(Principal principal,@PathVariable String namespace,@PathVariable String cluster) {
        return resources.namespace(identities.actor(principal.getName()),namespace,cluster);
    }
    @GetMapping("/usage/nodes")
    public ClusterUsage nodeUsage(Principal principal,@PathVariable String namespace,@PathVariable String cluster) {
        return resources.nodeUsage(identities.actor(principal.getName()),namespace,cluster);
    }
    @GetMapping("/usage/pods")
    public List<ContainerUsage> podUsage(Principal principal,@PathVariable String namespace,@PathVariable String cluster) {
        return resources.podUsage(identities.actor(principal.getName()),namespace,cluster);
    }
}
