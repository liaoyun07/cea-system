package com.project.platform.server.api;

import com.project.platform.offloading.*;
import com.project.platform.server.security.IdentityDirectory;
import java.security.Principal;
import java.util.List;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/namespaces/{namespace}/offloading")
public final class OffloadingController {
    private final OffloadingService service;private final IdentityDirectory identities;
    public OffloadingController(OffloadingService service,IdentityDirectory identities){this.service=service;this.identities=identities;}
    @PutMapping("/models/{version}")
    public DqnModel register(Principal principal,@PathVariable String namespace,@PathVariable String version,@RequestBody DqnModel model) {
        return service.register(identities.actor(principal.getName()),namespace,version,model);
    }
    @GetMapping("/models/{version}")
    public DqnModel model(Principal principal,@PathVariable String namespace,@PathVariable String version) {
        return service.model(identities.actor(principal.getName()),namespace,version);
    }
    @GetMapping("/samples")
    public List<OffloadingService.Sample> samples(Principal principal,@PathVariable String namespace,@RequestParam(defaultValue="20") int limit,@RequestParam(defaultValue="0") int offset) {
        return service.samples(identities.actor(principal.getName()),namespace,limit,offset);
    }
}
