package com.project.platform.server.api;

import com.project.platform.deployment.distribution.RegistryManagementService;
import com.project.platform.deployment.distribution.RegistryManagementService.*;
import com.project.platform.server.security.IdentityDirectory;
import java.security.Principal;
import java.util.List;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/namespaces/{namespace}/registries")
public final class RegistryController {
    private final RegistryManagementService service;
    private final IdentityDirectory identities;
    public RegistryController(RegistryManagementService service,IdentityDirectory identities) { this.service=service;this.identities=identities; }
    @GetMapping
    public List<RegistryInfo> registries(Principal p,@PathVariable String namespace) { return service.registries(identities.actor(p.getName()),namespace); }
    @GetMapping("/{registry}/repositories")
    public RepositoryPage repositories(Principal p,@PathVariable String namespace,@PathVariable String registry,@RequestParam(required=false) String last) {
        return service.repositories(identities.actor(p.getName()),namespace,registry,last);
    }
    @GetMapping("/{registry}/images")
    public List<ImageInfo> images(Principal p,@PathVariable String namespace,@PathVariable String registry,@RequestParam String repository) {
        return service.images(identities.actor(p.getName()),namespace,registry,repository);
    }
    @GetMapping("/{registry}/image")
    public ImageDetail detail(Principal p,@PathVariable String namespace,@PathVariable String registry,@RequestParam String repository,@RequestParam String digest) {
        return service.detail(identities.actor(p.getName()),namespace,registry,repository,digest);
    }
    @DeleteMapping("/{registry}/image")
    public void delete(Principal p,@PathVariable String namespace,@PathVariable String registry,@RequestParam String repository,@RequestParam String digest,@RequestParam String confirmation) {
        service.delete(identities.actor(p.getName()),namespace,registry,repository,digest,confirmation);
    }
}
