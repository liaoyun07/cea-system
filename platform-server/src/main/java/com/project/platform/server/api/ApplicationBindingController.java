package com.project.platform.server.api;

import com.project.platform.dataflow.application.ApplicationBindings.*;
import com.project.platform.dataflow.application.ApplicationBindingService;
import com.project.platform.server.security.IdentityDirectory;
import java.security.Principal;
import java.util.List;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/namespaces/{namespace}/application-bindings")
public final class ApplicationBindingController {
    private final ApplicationBindingService bindings;
    private final IdentityDirectory identities;
    public ApplicationBindingController(ApplicationBindingService bindings,IdentityDirectory identities) { this.bindings=bindings;this.identities=identities; }
    @PostMapping("/plan")
    public Plan plan(Principal principal,@PathVariable String namespace,@RequestBody Request request) {
        return bindings.plan(identities.actor(principal.getName()),namespace,request);
    }
    @PostMapping("/resolve")
    public List<ResolvedTask> resolve(Principal principal,@PathVariable String namespace,@RequestBody ResolveRequest request) {
        return bindings.resolve(identities.actor(principal.getName()),namespace,request);
    }
}
