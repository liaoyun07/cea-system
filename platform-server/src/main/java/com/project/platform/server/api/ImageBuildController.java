package com.project.platform.server.api;

import com.project.platform.deployment.upload.ImageBuildService;
import com.project.platform.deployment.upload.ImageUploadService;
import com.project.platform.server.security.IdentityDirectory;
import java.io.IOException;
import java.security.Principal;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api/namespaces/{namespace}/applications/{applicationId}/versions/{version}/build")
public final class ImageBuildController {
    private final ImageBuildService builds;
    private final IdentityDirectory identities;
    public ImageBuildController(ImageBuildService builds,IdentityDirectory identities){this.builds=builds;this.identities=identities;}
    @PostMapping(consumes="multipart/form-data")
    public ImageBuildService.Result build(Principal principal,@PathVariable String namespace,@PathVariable String applicationId,@PathVariable String version,
            @RequestPart("contract") ImageUploadService.Request contract,@RequestPart("file") MultipartFile file)throws IOException {
        try(var input=file.getInputStream()){return builds.build(identities.actor(principal.getName()),namespace,applicationId,version,contract,file.getSize(),input);}
    }
}
