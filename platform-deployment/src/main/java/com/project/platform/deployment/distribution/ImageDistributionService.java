package com.project.platform.deployment.distribution;

import com.project.platform.deployment.application.ApplicationCatalogService;
import com.project.platform.deployment.application.ApplicationException;
import com.project.platform.foundation.identity.AccessPolicy;
import com.project.platform.foundation.identity.AccessPolicy.*;
import com.project.platform.resource.catalog.ResourceCatalogService;
import com.project.platform.deployment.distribution.SkopeoImageClient.Registry;
import java.util.Map;
import java.util.List;
import java.time.Clock;
import java.time.Instant;

/** Explicit on-demand distribution. Does not create a Flow, Execution, Job or deployment. */
public final class ImageDistributionService {
    public record PreparedImage(String applicationId,String version,String clusterId,String image) {}
    public record Distribution(String id,String applicationId,String version,String clusterId,String requestedBy,
                               String sourceImage,String targetImage,String state,Instant startedAt,Instant finishedAt,String error) {}
    private final ApplicationCatalogService applications;
    private final ResourceCatalogService resources;
    private final AccessPolicy access;
    private final SkopeoImageClient images;
    private final Map<String,Registry> registries;
    private final Map<String,Map<String,String>> targets;
    private final JdbcImageDistributionRepository history;
    private final Clock clock;
    private final RegistryHttpClient registry;
    private final Map<String,RegistryHttpClient.Connection> connections;

    public ImageDistributionService(ApplicationCatalogService applications,ResourceCatalogService resources,AccessPolicy access,
                                    SkopeoImageClient images,Map<String,Registry> registries,Map<String,Map<String,String>> targets,
                                    JdbcImageDistributionRepository history,Clock clock,RegistryHttpClient registryClient,
                                    Map<String,RegistryHttpClient.Connection> connections) {
        this.applications=applications;this.resources=resources;this.access=access;this.images=images;
        this.registries=Map.copyOf(registries);
        this.history=history;this.clock=clock;
        this.registry=registryClient;this.connections=Map.copyOf(connections);
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
        return copy(actor,namespace,applicationId,version,clusterId);
    }
    /** Internal execution consumer: executing a registered application does not grant catalog write permission. */
    public PreparedImage prepareForExecution(Actor actor,String namespace,String applicationId,String version,String clusterId) {
        access.require(actor,namespace,Action.EXECUTE);
        return copy(actor,namespace,applicationId,version,clusterId);
    }
    public List<Distribution> history(Actor actor,String namespace,String applicationId,String version,int limit,int offset) {
        access.require(actor,namespace,Action.READ);
        if(limit<1 || limit>100 || offset<0 || offset>1_000_000)throw ApplicationException.invalid("limit 1..100, offset 0..1000000 required");
        return history.list(namespace,applicationId,version,limit,offset,clock.instant());
    }
    private PreparedImage copy(Actor actor,String namespace,String applicationId,String version,String clusterId) {
        var app=applications.get(actor,namespace,applicationId,version);
        if(!resources.cluster(actor,namespace,clusterId).enabled()) throw ApplicationException.invalid("target cluster is disabled");
        String targetName=targets.getOrDefault(namespace,Map.of()).get(clusterId);
        var target=targetName==null?null:registries.get(targetName);
        if(target==null) throw ApplicationException.invalid("no distribution target configured for namespace/cluster");
        var source=registries.values().stream().filter(r->app.image().startsWith(r.address()+"/")).findFirst()
                .orElseThrow(()->ApplicationException.invalid("application image must use an explicitly configured registry"));
        // Reject names that would need rewriting; never merge distinct application identities.
        if(!namespace.matches("[a-z][a-z0-9.-]*") || !applicationId.matches("[a-z][a-z0-9.-]*"))
            throw ApplicationException.invalid("distribution requires lowercase OCI-compatible namespace/application id");
        var now=clock.instant();
        String id=null;
        try {
            // Pinned references already identify immutable content. Tags must still be resolved freshly.
            String digest=app.image().contains("@")?app.image().substring(app.image().indexOf('@')+1):images.digest(app.image(),source);
            String repository=app.image().contains("@")?app.image().substring(0,app.image().indexOf('@')):app.image().substring(0,app.image().lastIndexOf(':'));
            String targetImage=target.address()+"/"+namespace+"/"+applicationId+"@"+digest;
            if(registry.hasManifest(connections.get(targetName),namespace+"/"+applicationId,digest))
                return new PreparedImage(applicationId,version,clusterId,targetImage);
            // Reuse is not a transfer: only actual copy attempts/failures create distribution history.
            id=history.begin(namespace,applicationId,version,clusterId,actor.name(),app.image(),now,now.plus(images.timeout().multipliedBy(3)).plusSeconds(15));
            history.target(id,targetImage);
            images.copy(repository+"@"+digest,source,targetImage,target);
            if(!registry.hasManifest(connections.get(targetName),namespace+"/"+applicationId,digest))throw new SkopeoImageClient.Failure("Target image digest could not be confirmed after copy");
            history.finish(id,"SUCCEEDED",null,clock.instant());
            return new PreparedImage(applicationId,version,clusterId,targetImage);
        } catch(RuntimeException ex) {
            // Never persist infrastructure exceptions/commands/credentials as free-form text.
            String message=ex instanceof SkopeoImageClient.Failure?ex.getMessage():"Image preparation could not be confirmed";
            if(id==null)id=history.begin(namespace,applicationId,version,clusterId,actor.name(),app.image(),now,now.plus(images.timeout().multipliedBy(3)).plusSeconds(15));
            history.finish(id,Thread.currentThread().isInterrupted()?"UNKNOWN":"FAILED",message,clock.instant());
            throw ex;
        }
    }
}
