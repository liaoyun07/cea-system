package com.project.platform.server.api;

import com.project.platform.deployment.application.*;
import com.project.platform.server.security.IdentityDirectory;
import java.security.Principal;
import java.util.List;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import com.project.platform.deployment.upload.ImageUploadService;

@RestController
@RequestMapping("/api/namespaces/{namespace}/applications")
public final class ApplicationController {
    private final ApplicationCatalogService applications;
    private final IdentityDirectory identities;
    private final ImageUploadService uploads;
    public ApplicationController(ApplicationCatalogService applications,IdentityDirectory identities,ImageUploadService uploads) { this.applications=applications;this.identities=identities;this.uploads=uploads; }
    @PostMapping(value="/{applicationId}/versions/{version}/upload",consumes="multipart/form-data")
    public ApplicationVersion upload(Principal principal,@PathVariable String namespace,@PathVariable String applicationId,@PathVariable String version,
                                     @RequestPart("contract") ImageUploadService.Request request,@RequestPart("file") MultipartFile file) throws java.io.IOException {
        try(var content=file.getInputStream()) {
            return uploads.upload(identities.actor(principal.getName()),namespace,applicationId,version,request,file.getSize(),content);
        }
    }
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
