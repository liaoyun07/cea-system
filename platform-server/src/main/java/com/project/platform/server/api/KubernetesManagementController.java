package com.project.platform.server.api;

import com.project.platform.resource.kubernetes.KubernetesManagementService;
import com.project.platform.resource.kubernetes.KubernetesManagementService.*;
import com.project.platform.server.security.IdentityDirectory;
import java.security.Principal;
import java.util.List;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/namespaces/{namespace}/clusters/{cluster}/kubernetes/namespaces")
public final class KubernetesManagementController {
    private final KubernetesManagementService service;
    private final IdentityDirectory identities;
    public KubernetesManagementController(KubernetesManagementService service,IdentityDirectory identities) { this.service=service;this.identities=identities; }
    @GetMapping
    public List<NamespaceInfo> namespaces(Principal p,@PathVariable String namespace,@PathVariable String cluster) {
        return service.namespaces(identities.actor(p.getName()),namespace,cluster);
    }
    @PostMapping
    public NamespaceInfo createNamespace(Principal p,@PathVariable String namespace,@PathVariable String cluster,@RequestBody NamespaceRequest request) {
        return service.createNamespace(identities.actor(p.getName()),namespace,cluster,request);
    }
    @DeleteMapping("/{kubeNamespace}")
    public void deleteNamespace(Principal p,@PathVariable String namespace,@PathVariable String cluster,@PathVariable String kubeNamespace,@RequestParam String uid,@RequestParam String resourceVersion) {
        service.deleteNamespace(identities.actor(p.getName()),namespace,cluster,kubeNamespace,uid,resourceVersion);
    }
    @GetMapping("/{kubeNamespace}/services")
    public List<ServiceInfo> services(Principal p,@PathVariable String namespace,@PathVariable String cluster,@PathVariable String kubeNamespace) {
        return service.services(identities.actor(p.getName()),namespace,cluster,kubeNamespace);
    }
    @PostMapping("/{kubeNamespace}/services")
    public ServiceInfo createService(Principal p,@PathVariable String namespace,@PathVariable String cluster,@PathVariable String kubeNamespace,@RequestBody ServiceRequest request) {
        return service.createService(identities.actor(p.getName()),namespace,cluster,kubeNamespace,request);
    }
    @GetMapping("/{kubeNamespace}/services/{name}")
    public ServiceInfo service(Principal p,@PathVariable String namespace,@PathVariable String cluster,@PathVariable String kubeNamespace,@PathVariable String name) {
        return service.service(identities.actor(p.getName()),namespace,cluster,kubeNamespace,name);
    }
    @DeleteMapping("/{kubeNamespace}/services/{name}")
    public void deleteService(Principal p,@PathVariable String namespace,@PathVariable String cluster,@PathVariable String kubeNamespace,@PathVariable String name,@RequestParam String uid,@RequestParam String resourceVersion) {
        service.deleteService(identities.actor(p.getName()),namespace,cluster,kubeNamespace,name,uid,resourceVersion);
    }
}
