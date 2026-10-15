package com.project.platform.server.api;

import com.project.platform.deployment.distribution.RegistryManagementService;
import com.project.platform.deployment.distribution.RegistryManagementService.*;
import com.project.platform.deployment.distribution.ImageDownloadService;
import com.project.platform.server.security.IdentityDirectory;
import java.security.Principal;
import java.util.List;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/namespaces/{namespace}/registries")
public final class RegistryController {
    private final RegistryManagementService service;
    private final IdentityDirectory identities;
    private final ImageDownloadService downloads;
    public RegistryController(RegistryManagementService service,IdentityDirectory identities,ImageDownloadService downloads) { this.service=service;this.identities=identities;this.downloads=downloads; }
    @GetMapping("/{registry}/download")
    public void download(Principal p,@PathVariable String namespace,@PathVariable String registry,@RequestParam String repository,
            @RequestParam String digest,jakarta.servlet.http.HttpServletResponse response) throws java.io.IOException {
        try(var download=downloads.prepare(identities.actor(p.getName()),namespace,registry,repository,digest)) {
            response.setContentType("application/x-tar");response.setContentLengthLong(java.nio.file.Files.size(download.archive()));
            response.setHeader("Content-Disposition",org.springframework.http.ContentDisposition.attachment().filename(download.filename()).build().toString());
            response.setHeader("Cache-Control","no-store");
            java.nio.file.Files.copy(download.archive(),response.getOutputStream());
        }
    }
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
    @GetMapping("/{registry}/inventory")
    public InventoryPage inventory(Principal p,@PathVariable String namespace,@PathVariable String registry,
            @RequestParam(required=false) String repository,@RequestParam(defaultValue="20") int limit,
            @RequestParam(required=false) String afterRepository,@RequestParam(required=false) String afterDigest) {
        return service.inventory(identities.actor(p.getName()),namespace,registry,repository,limit,afterRepository,afterDigest);
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
