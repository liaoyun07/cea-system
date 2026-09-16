package com.project.platform.server.api;

import com.project.platform.resource.kubernetes.KubernetesManagementService;
import com.project.platform.resource.kubernetes.KubernetesManagementService.*;
import com.project.platform.server.security.IdentityDirectory;
import java.security.Principal;
import java.util.List;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/namespaces/{namespace}/clusters/{cluster}/kubernetes")
public final class KubernetesManagementController {
    private final KubernetesManagementService service;
    private final IdentityDirectory identities;
    public KubernetesManagementController(KubernetesManagementService service,IdentityDirectory identities) { this.service=service;this.identities=identities; }
    @GetMapping("/namespaces")
    public List<NamespaceInfo> namespaces(Principal p,@PathVariable String namespace,@PathVariable String cluster) {
        return service.namespaces(identities.actor(p.getName()),namespace,cluster);
    }
    @GetMapping("/ingress-classes")
    public List<IngressClassInfo> ingressClasses(Principal p,@PathVariable String namespace,@PathVariable String cluster) {
        return service.ingressClasses(identities.actor(p.getName()),namespace,cluster);
    }
    @GetMapping("/namespaces/{kubeNamespace}/ingresses")
    public List<IngressInfo> ingresses(Principal p,@PathVariable String namespace,@PathVariable String cluster,@PathVariable String kubeNamespace) {
        return service.ingresses(identities.actor(p.getName()),namespace,cluster,kubeNamespace);
    }
    @PostMapping("/namespaces/{kubeNamespace}/ingresses")
    public IngressInfo createIngress(Principal p,@PathVariable String namespace,@PathVariable String cluster,@PathVariable String kubeNamespace,@RequestBody IngressRequest request) {
        return service.createIngress(identities.actor(p.getName()),namespace,cluster,kubeNamespace,request);
    }
    @GetMapping("/namespaces/{kubeNamespace}/ingresses/{name}")
    public IngressInfo ingress(Principal p,@PathVariable String namespace,@PathVariable String cluster,@PathVariable String kubeNamespace,@PathVariable String name) {
        return service.ingress(identities.actor(p.getName()),namespace,cluster,kubeNamespace,name);
    }
    @PutMapping("/namespaces/{kubeNamespace}/ingresses/{name}")
    public IngressInfo updateIngress(Principal p,@PathVariable String namespace,@PathVariable String cluster,@PathVariable String kubeNamespace,@PathVariable String name,@RequestParam String uid,@RequestParam String resourceVersion,@RequestBody IngressRequest request) {
        return service.updateIngress(identities.actor(p.getName()),namespace,cluster,kubeNamespace,name,uid,resourceVersion,request);
    }
    @DeleteMapping("/namespaces/{kubeNamespace}/ingresses/{name}")
    public void deleteIngress(Principal p,@PathVariable String namespace,@PathVariable String cluster,@PathVariable String kubeNamespace,@PathVariable String name,@RequestParam String uid,@RequestParam String resourceVersion) {
        service.deleteIngress(identities.actor(p.getName()),namespace,cluster,kubeNamespace,name,uid,resourceVersion);
    }
    @PostMapping("/namespaces")
    public NamespaceInfo createNamespace(Principal p,@PathVariable String namespace,@PathVariable String cluster,@RequestBody NamespaceRequest request) {
        return service.createNamespace(identities.actor(p.getName()),namespace,cluster,request);
    }
    @DeleteMapping("/namespaces/{kubeNamespace}")
    public void deleteNamespace(Principal p,@PathVariable String namespace,@PathVariable String cluster,@PathVariable String kubeNamespace,@RequestParam String uid,@RequestParam String resourceVersion) {
        service.deleteNamespace(identities.actor(p.getName()),namespace,cluster,kubeNamespace,uid,resourceVersion);
    }
    @GetMapping("/namespaces/{kubeNamespace}/services")
    public List<ServiceInfo> services(Principal p,@PathVariable String namespace,@PathVariable String cluster,@PathVariable String kubeNamespace) {
        return service.services(identities.actor(p.getName()),namespace,cluster,kubeNamespace);
    }
    @PostMapping("/namespaces/{kubeNamespace}/services")
    public ServiceInfo createService(Principal p,@PathVariable String namespace,@PathVariable String cluster,@PathVariable String kubeNamespace,@RequestBody ServiceRequest request) {
        return service.createService(identities.actor(p.getName()),namespace,cluster,kubeNamespace,request);
    }
    @GetMapping("/namespaces/{kubeNamespace}/services/{name}")
    public ServiceInfo service(Principal p,@PathVariable String namespace,@PathVariable String cluster,@PathVariable String kubeNamespace,@PathVariable String name) {
        return service.service(identities.actor(p.getName()),namespace,cluster,kubeNamespace,name);
    }
    @DeleteMapping("/namespaces/{kubeNamespace}/services/{name}")
    public void deleteService(Principal p,@PathVariable String namespace,@PathVariable String cluster,@PathVariable String kubeNamespace,@PathVariable String name,@RequestParam String uid,@RequestParam String resourceVersion) {
        service.deleteService(identities.actor(p.getName()),namespace,cluster,kubeNamespace,name,uid,resourceVersion);
    }
}
