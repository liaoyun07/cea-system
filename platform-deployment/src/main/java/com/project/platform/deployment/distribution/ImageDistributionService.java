package com.project.platform.deployment.distribution;

import com.project.platform.deployment.application.ApplicationCatalogService;
import com.project.platform.deployment.application.ApplicationException;
import com.project.platform.foundation.identity.AccessPolicy;
import com.project.platform.foundation.identity.AccessPolicy.*;
import com.project.platform.resource.catalog.ResourceCatalogService;
import com.project.platform.deployment.distribution.SkopeoImageClient.Registry;
import java.util.Map;

/** Explicit on-demand distribution. Does not create a Flow, Execution, Job or deployment. */
public final class ImageDistributionService {
    public record PreparedImage(String applicationId,String version,String clusterId,String image) {}
    private final ApplicationCatalogService applications;
    private final ResourceCatalogService resources;
    private final AccessPolicy access;
    private final SkopeoImageClient images;
    private final Map<String,Registry> registries;
    private final Map<String,Map<String,String>> targets;

    public ImageDistributionService(ApplicationCatalogService applications,ResourceCatalogService resources,AccessPolicy access,
                                    SkopeoImageClient images,Map<String,Registry> registries,Map<String,Map<String,String>> targets) {
        this.applications=applications;this.resources=resources;this.access=access;this.images=images;
        this.registries=Map.copyOf(registries);
        this.targets=targets.entrySet().stream().collect(java.util.stream.Collectors.toUnmodifiableMap(Map.Entry::getKey,e->Map.copyOf(e.getValue())));
        for(var registry:registries.values()) {
            if(registry.address()==null || !registry.address().matches("[a-z0-9][a-z0-9.-]*(?::[0-9]{1,5})?"))
                throw new IllegalArgumentException("registry address must be host[:port], without credentials or scheme");
        }
        for(var clusters:targets.values()) for(String registry:clusters.values())
            if(!registries.containsKey(registry)) throw new IllegalArgumentException("distribution target references unconfigured registry");
    }
    public PreparedImage prepare(Actor actor,String namespace,String applicationId,String version,String clusterId) {
        access.require(actor,namespace,Action.WRITE);
        var app=applications.get(actor,namespace,applicationId,version);
        if(!resources.cluster(actor,namespace,clusterId).enabled()) throw ApplicationException.invalid("target cluster is disabled");
        String targetName=targets.getOrDefault(namespace,Map.of()).get(clusterId);
        var target=targetName==null?null:registries.get(targetName);
        if(target==null) throw ApplicationException.invalid("no distribution target configured for namespace/cluster");
        var source=registries.values().stream().filter(r->app.image().startsWith(r.address()+"/")).findFirst()
                .orElseThrow(()->ApplicationException.invalid("application image must use an explicitly configured registry"));
        String digest=images.digest(app.image(),source);
        String repository=app.image().contains("@")?app.image().substring(0,app.image().indexOf('@')):app.image().substring(0,app.image().lastIndexOf(':'));
        // Reject names that would need rewriting; never merge distinct application identities.
        if(!namespace.matches("[a-z][a-z0-9.-]*") || !applicationId.matches("[a-z][a-z0-9.-]*"))
            throw ApplicationException.invalid("distribution requires lowercase OCI-compatible namespace/application id");
        String targetImage=target.address()+"/"+namespace+"/"+applicationId+"@"+digest;
        images.copy(repository+"@"+digest,source,targetImage,target);
        if(!digest.equals(images.digest(targetImage,target))) throw new SkopeoImageClient.Failure("Target image digest does not match source");
        return new PreparedImage(applicationId,version,clusterId,targetImage);
    }
}
