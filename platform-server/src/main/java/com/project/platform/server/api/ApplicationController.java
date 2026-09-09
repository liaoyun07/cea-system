package com.project.platform.server.api;

import com.project.platform.deployment.application.*;
import com.project.platform.server.security.IdentityDirectory;
import java.security.Principal;
import java.util.List;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/namespaces/{namespace}/applications")
public final class ApplicationController {
    private final ApplicationCatalogService applications;
    private final IdentityDirectory identities;
    public ApplicationController(ApplicationCatalogService applications,IdentityDirectory identities) { this.applications=applications;this.identities=identities; }
    @PutMapping("/{applicationId}/versions/{version}")
    public ApplicationVersion register(Principal principal,@PathVariable String namespace,@PathVariable String applicationId,@PathVariable String version,@RequestBody ApplicationVersion request) {
        return applications.register(identities.actor(principal.getName()),namespace,applicationId,version,request);
    }
    @GetMapping("/{applicationId}/versions/{version}")
    public ApplicationVersion get(Principal principal,@PathVariable String namespace,@PathVariable String applicationId,@PathVariable String version) {
        return applications.get(identities.actor(principal.getName()),namespace,applicationId,version);
    }
    @GetMapping
    public List<ApplicationVersion> list(Principal principal,@PathVariable String namespace,@RequestParam(defaultValue="20") int limit,@RequestParam(defaultValue="0") int offset) {
        return applications.list(identities.actor(principal.getName()),namespace,limit,offset);
    }
}
