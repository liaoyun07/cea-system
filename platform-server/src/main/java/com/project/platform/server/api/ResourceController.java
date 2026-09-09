package com.project.platform.server.api;

import com.project.platform.resource.catalog.ResourceCatalog.*;
import com.project.platform.resource.catalog.ResourceCatalogService;
import com.project.platform.server.security.IdentityDirectory;
import java.security.Principal;
import java.util.List;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/namespaces/{namespace}/resources")
public final class ResourceController {
    private final ResourceCatalogService resources;
    private final IdentityDirectory identities;
    public ResourceController(ResourceCatalogService resources,IdentityDirectory identities) { this.resources=resources;this.identities=identities; }
    @PutMapping("/clusters/{clusterId}")
    public Cluster putCluster(Principal principal,@PathVariable String namespace,@PathVariable String clusterId,@RequestBody Cluster request) {
        return resources.putCluster(identities.actor(principal.getName()),namespace,clusterId,request);
    }
    @GetMapping("/clusters/{clusterId}")
    public Cluster cluster(Principal principal,@PathVariable String namespace,@PathVariable String clusterId) {
        return resources.cluster(identities.actor(principal.getName()),namespace,clusterId);
    }
    @GetMapping("/clusters")
    public List<Cluster> clusters(Principal principal,@PathVariable String namespace,@RequestParam(defaultValue="20") int limit,@RequestParam(defaultValue="0") int offset) {
        return resources.clusters(identities.actor(principal.getName()),namespace,limit,offset);
    }
    @PutMapping("/datasets/{datasetId}/versions/{version}")
    public DatasetVersion registerDataset(Principal principal,@PathVariable String namespace,@PathVariable String datasetId,@PathVariable String version,@RequestBody DatasetVersion request) {
        return resources.registerDataset(identities.actor(principal.getName()),namespace,datasetId,version,request);
    }
    @GetMapping("/datasets/{datasetId}/versions/{version}")
    public DatasetVersion dataset(Principal principal,@PathVariable String namespace,@PathVariable String datasetId,@PathVariable String version) {
        return resources.dataset(identities.actor(principal.getName()),namespace,datasetId,version);
    }
    @GetMapping("/datasets")
    public List<DatasetVersion> datasets(Principal principal,@PathVariable String namespace,@RequestParam(defaultValue="20") int limit,@RequestParam(defaultValue="0") int offset) {
        return resources.datasets(identities.actor(principal.getName()),namespace,limit,offset);
    }
    @PostMapping("/placement-options")
    public List<PlacementOption> placementOptions(Principal principal,@PathVariable String namespace,@RequestBody PlacementRequest request) {
        return resources.placementOptions(identities.actor(principal.getName()),namespace,request);
    }
}
