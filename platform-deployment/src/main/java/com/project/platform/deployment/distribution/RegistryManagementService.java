package com.project.platform.deployment.distribution;

import com.project.platform.deployment.application.*;
import com.project.platform.foundation.identity.AccessPolicy;
import com.project.platform.foundation.identity.AccessPolicy.*;
import com.project.platform.resource.kubernetes.KubernetesManagementService;
import java.util.*;

/** Actual manifest reads establish inventory; catalog/history supply candidates, never proof of presence. */
public final class RegistryManagementService {
    public record RegistryInfo(String id,String address) {}
    public record RepositoryPage(List<String> repositories,String next) {}
    public record ImageInfo(String digest,List<String> tags) {}
    public record InventoryImage(String repository,String digest,List<String> tags) {}
    public record InventoryCursor(String repository,String digest) {}
    public record InventoryPage(List<InventoryImage> images,InventoryCursor next) {}
    public record PlatformInfo(String digest,String os,String architecture,String variant) {}
    public record ImageDetail(String repository,String digest,List<String> tags,String mediaType,Long layerBytes,String created,
                              List<PlatformInfo> platforms,List<String> blockers) {}
    private final AccessPolicy access;
    private final ApplicationCatalogService applications;
    private final KubernetesManagementService kubernetes;
    private final JdbcImageDistributionRepository history;
    private final RegistryHttpClient client;
    private final Map<String,RegistryHttpClient.Connection> registries;
    private final Map<String,Set<String>> scopes;
    public RegistryManagementService(AccessPolicy access,ApplicationCatalogService applications,KubernetesManagementService kubernetes,
            JdbcImageDistributionRepository history,RegistryHttpClient client,Map<String,RegistryHttpClient.Connection> registries,Map<String,Set<String>> scopes) {
        this.access=access;this.applications=applications;this.kubernetes=kubernetes;this.history=history;this.client=client;this.registries=Map.copyOf(registries);
        this.scopes=scopes.entrySet().stream().collect(java.util.stream.Collectors.toUnmodifiableMap(Map.Entry::getKey,e->Set.copyOf(e.getValue())));
    }
    public List<RegistryInfo> registries(Actor actor,String namespace) {
        access.require(actor,namespace,Action.READ);
        return scopes.getOrDefault(namespace,Set.of()).stream().sorted().map(id->new RegistryInfo(id,registries.get(id).address())).toList();
    }
    private RegistryHttpClient.Connection connection(Actor actor,String namespace,String registry,Action action) {
        access.require(actor,namespace,action);
        if(!scopes.getOrDefault(namespace,Set.of()).contains(registry))throw new AccessPolicy.Forbidden();
        return registries.get(registry);
    }
    private static void repository(String namespace,String repository) {
        if(repository==null || repository.length()>255 || !repository.startsWith(namespace+"/") || !repository.matches("[a-z0-9]+(?:[._-][a-z0-9]+)*(?:/[a-z0-9]+(?:[._-][a-z0-9]+)*)+"))
            throw ApplicationException.invalid("repository must belong to the current workspace");
    }
    public RepositoryPage repositories(Actor actor,String namespace,String registry,String last) {
        var page=client.repositories(connection(actor,namespace,registry,Action.READ),last==null || last.isBlank()?null:last);
        return new RepositoryPage(page.values().stream().filter(r->r.startsWith(namespace+"/")).toList(),page.next());
    }
    /** Flatten verified images, not repository names. Read only until one image beyond this page is found. */
    public InventoryPage inventory(Actor actor,String namespace,String registry,String filter,int limit,String afterRepository,String afterDigest) {
        var connection=connection(actor,namespace,registry,Action.READ);
        String query=filter==null?"":filter.trim();
        if(limit<1 || limit>100 || query.length()>255)throw ApplicationException.invalid("inventory limit must be 1..100; repository filter at most 255 characters");
        if((afterRepository==null)!=(afterDigest==null))throw ApplicationException.invalid("both inventory cursor fields are required");
        var rows=new ArrayList<InventoryImage>();
        if(afterRepository!=null) {
            repository(namespace,afterRepository);
            if(!afterDigest.matches("sha256:[a-f0-9]{64}"))throw ApplicationException.invalid("invalid inventory digest cursor");
            if(!afterRepository.contains(query))throw ApplicationException.invalid("cursor does not match repository filter");
            appendImages(actor,namespace,registry,afterRepository,afterDigest,limit,rows);
        }
        String last=afterRepository;
        while(rows.size()<=limit) {
            var page=client.repositories(connection,last);
            for(String path:page.values()) {
                if(!path.startsWith(namespace+"/") || !path.contains(query))continue;
                appendImages(actor,namespace,registry,path,null,limit,rows);
                if(rows.size()>limit)break;
            }
            if(rows.size()>limit || page.next()==null)break;
            if(last!=null && page.next().compareTo(last)<=0)throw new SkopeoImageClient.Failure("Registry returned a non-advancing catalog cursor");
            last=page.next();
        }
        if(rows.size()<=limit)return new InventoryPage(List.copyOf(rows),null);
        var end=rows.get(limit-1);
        return new InventoryPage(List.copyOf(rows.subList(0,limit)),new InventoryCursor(end.repository(),end.digest()));
    }
    private void appendImages(Actor actor,String namespace,String registry,String path,String afterDigest,int limit,List<InventoryImage> rows) {
        for(var image:images(actor,namespace,registry,path)) {
            if(afterDigest!=null && image.digest().compareTo(afterDigest)<=0)continue;
            rows.add(new InventoryImage(path,image.digest(),image.tags()));
            if(rows.size()>limit)return;
        }
    }
    private List<ApplicationVersion> applications(Actor actor,String namespace) {
        var values=new ArrayList<ApplicationVersion>();int offset=0;
        while(true) { var page=applications.list(actor,namespace,100,offset);values.addAll(page);if(page.size()<100)return values;offset+=100; }
    }
    private Set<String> knownDigests(Actor actor,String namespace,RegistryHttpClient.Connection connection,String repository) {
        String prefix=connection.address()+"/"+repository+"@";
        var digests=new HashSet<String>();
        for(String image:history.knownTargets(namespace))if(image.startsWith(prefix))digests.add(image.substring(prefix.length()));
        for(var app:applications.knownImages(actor,namespace).entrySet())for(String image:app.getValue()) {
            int marker=image.indexOf("@sha256:");
            // Existing on-demand copies use namespace/applicationId even when the source repository differs.
            // The contract supplies only a candidate digest; the destination manifest must still exist.
            if(marker>=0 && (image.startsWith(prefix) || repository.equals(namespace+"/"+app.getKey())))digests.add(image.substring(marker+1));
            else if(marker<0 && repository.equals(namespace+"/"+app.getKey())) {
                var source=scopes.getOrDefault(namespace,Set.of()).stream().map(registries::get)
                        .filter(r->image.startsWith(r.address()+"/")).findFirst().orElse(null);
                if(source!=null) {
                    int tag=image.lastIndexOf(':');
                    var manifest=client.manifest(source,image.substring(source.address().length()+1,tag),image.substring(tag+1));
                    if(manifest==null)throw new SkopeoImageClient.Failure("Registered source tag is unavailable; untagged inventory cannot be fully verified");
                    digests.add(manifest.digest());
                }
            }
        }
        return digests;
    }
    public List<ImageInfo> images(Actor actor,String namespace,String registry,String repository) {
        var connection=connection(actor,namespace,registry,Action.READ);repository(namespace,repository);
        var rows=new TreeMap<String,Set<String>>();
        for(String tag:client.tags(connection,repository)) {
            var manifest=client.manifest(connection,repository,tag);if(manifest!=null)rows.computeIfAbsent(manifest.digest(),ignored->new TreeSet<>()).add(tag);
        }
        for(String digest:knownDigests(actor,namespace,connection,repository)) {
            if(!rows.containsKey(digest) && client.manifest(connection,repository,digest)!=null)rows.put(digest,new TreeSet<>());
        }
        return rows.entrySet().stream().map(e->new ImageInfo(e.getKey(),List.copyOf(e.getValue()))).toList();
    }
    public ImageDetail detail(Actor actor,String namespace,String registry,String repository,String digest) {
        var connection=connection(actor,namespace,registry,Action.READ);repository(namespace,repository);
        if(digest==null || !digest.matches("sha256:[a-f0-9]{64}"))throw ApplicationException.invalid("image detail requires the exact sha256 digest");
        var manifest=client.manifest(connection,repository,digest);
        if(manifest==null)throw ApplicationException.missing("image manifest not found in this registry");
        var tags=new ArrayList<String>();var blockers=new LinkedHashSet<String>();
        for(String tag:client.tags(connection,repository)) {
            var other=client.manifest(connection,repository,tag);if(other==null)continue;
            if(other.digest().equals(manifest.digest()))tags.add(tag);
            else if(contains(connection,repository,other,manifest.digest(),new HashSet<>(),0))blockers.add("被多平台镜像索引引用："+tag);
        }
        for(String known:knownDigests(actor,namespace,connection,repository)) {
            if(!known.equals(manifest.digest())) {
                var parent=client.manifest(connection,repository,known);
                if(parent!=null && contains(connection,repository,parent,manifest.digest(),new HashSet<>(),0))blockers.add("被已核验的无标签镜像索引引用："+parent.digest());
            }
        }
        for(var app:applications(actor,namespace))if(references(connection,repository,app.image(),manifest.digest()))blockers.add("应用契约引用："+app.applicationId()+"/"+app.version());
        try {
            for(String image:kubernetes.workloadImages(actor,namespace))if(references(connection,repository,image,manifest.digest()))blockers.add("Kubernetes 工作负载引用："+image);
        } catch(com.project.platform.resource.kubernetes.KubernetesResourceService.Unavailable ex) {
            blockers.add("集群引用检查不可用，禁止删除");
        }
        for(String image:history.unfinishedImages(namespace))if(references(connection,repository,image,manifest.digest()))blockers.add("未确认结束的镜像分发引用："+image);
        var document=manifest.document();Long size=null;String created=null;var platforms=new ArrayList<PlatformInfo>();
        if(document.has("manifests")) {
            for(var child:document.path("manifests"))platforms.add(new PlatformInfo(child.path("digest").asString(),child.path("platform").path("os").asString(null),child.path("platform").path("architecture").asString(null),child.path("platform").path("variant").asString(null)));
        } else {
            long bytes=0;for(var layer:document.path("layers"))bytes=Math.addExact(bytes,layer.path("size").asLong());size=bytes;
            if(document.has("config")) {
                var config=client.config(connection,repository,document.path("config").path("digest").asString());
                created=config.path("created").asString(null);platforms.add(new PlatformInfo(manifest.digest(),config.path("os").asString(null),config.path("architecture").asString(null),config.path("variant").asString(null)));
            }
        }
        return new ImageDetail(repository,manifest.digest(),tags,document.path("mediaType").asString(null),size,created,platforms,List.copyOf(blockers));
    }
    private boolean contains(RegistryHttpClient.Connection connection,String repository,RegistryHttpClient.Manifest manifest,String digest,Set<String> visited,int depth) {
        if(manifest.digest().equals(digest))return true;
        if(depth>4 || visited.size()>128)throw new SkopeoImageClient.Failure("Image index reference graph cannot be safely verified");
        if(!visited.add(manifest.digest()))return false;
        for(var child:manifest.document().path("manifests")) {
            String childDigest=child.path("digest").asString();if(digest.equals(childDigest))return true;
            String media=child.path("mediaType").asString("");
            if(media.contains("image.index") || media.contains("manifest.list")) {
                var nested=client.manifest(connection,repository,childDigest);
                if(nested==null)throw ApplicationException.conflict("image index contains an unavailable nested manifest");
                if(contains(connection,repository,nested,digest,visited,depth+1))return true;
            }
        }
        return false;
    }
    private boolean references(RegistryHttpClient.Connection connection,String repository,String image,String digest) {
        if(image.equals(digest))return true;
        String prefix=connection.address()+"/"+repository;
        if(!image.startsWith(prefix+"@") && !image.startsWith(prefix+":") && !image.equals(prefix))return false;
        String reference=image.equals(prefix)?"latest":image.substring(prefix.length()+1);
        if(reference.equals(digest))return true;
        var resolved=client.manifest(connection,repository,reference);
        // An unresolved registered/in-use tag is not evidence that deleting a digest is safe.
        if(resolved==null)throw ApplicationException.conflict("cannot verify referenced image: "+image);
        return contains(connection,repository,resolved,digest,new HashSet<>(),0);
    }
    public void delete(Actor actor,String namespace,String registry,String repository,String digest,String confirmation) {
        var connection=connection(actor,namespace,registry,Action.WRITE);repository(namespace,repository);
        if(!Objects.equals(repository+"@"+digest,confirmation))throw ApplicationException.invalid("confirmation must equal repository@digest");
        var detail=detail(actor,namespace,registry,repository,digest);
        if(!detail.blockers().isEmpty())throw ApplicationException.conflict(String.join("；",detail.blockers()));
        client.delete(connection,repository,detail.digest());
    }
}
