package com.project.platform.server.api;

import com.project.platform.dataflow.definition.NamespaceFileService;
import com.project.platform.server.security.IdentityDirectory;
import java.security.Principal;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/namespaces/{namespace}/files")
public final class NamespaceFileController {
    public record Save(String path,int expectedRevision,String content) {}
    private final NamespaceFileService files;
    private final IdentityDirectory identities;
    public NamespaceFileController(NamespaceFileService files,IdentityDirectory identities){this.files=files;this.identities=identities;}
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public NamespaceFileService.File save(Principal principal,@PathVariable String namespace,@RequestBody Save request) {
        return files.save(identities.actor(principal.getName()),namespace,request.path(),request.expectedRevision(),request.content());
    }
    @GetMapping("/revision")
    public NamespaceFileService.File get(Principal principal,@PathVariable String namespace,@RequestParam String path,@RequestParam int revision) {
        return files.get(identities.actor(principal.getName()),namespace,path,revision);
    }
    @GetMapping
    public List<NamespaceFileService.Entry> list(Principal principal,@PathVariable String namespace,
            @RequestParam(defaultValue="20") int limit,@RequestParam(defaultValue="0") int offset) {
        return files.list(identities.actor(principal.getName()),namespace,limit,offset);
    }
}
