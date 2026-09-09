package com.project.platform.server.api;

import com.project.platform.deployment.distribution.ImageDistributionService;
import com.project.platform.deployment.distribution.ImageDistributionService.PreparedImage;
import com.project.platform.server.security.IdentityDirectory;
import java.security.Principal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/namespaces/{namespace}/applications/{applicationId}/versions/{version}/preparations")
public final class ImageDistributionController {
    private final ImageDistributionService distribution;
    private final IdentityDirectory identities;
    public ImageDistributionController(ImageDistributionService distribution,IdentityDirectory identities) { this.distribution=distribution;this.identities=identities; }
    @PostMapping("/{clusterId}")
    public PreparedImage prepare(Principal principal,@PathVariable String namespace,@PathVariable String applicationId,
                                 @PathVariable String version,@PathVariable String clusterId) {
        return distribution.prepare(identities.actor(principal.getName()),namespace,applicationId,version,clusterId);
    }
}
