package com.project.platform.resource.catalog;

import com.project.platform.foundation.identity.AccessPolicy;
import com.project.platform.foundation.identity.AccessPolicy.*;
import com.project.platform.resource.catalog.ResourceCatalog.*;
import java.net.URI;
import java.util.*;

/** Public namespace-authorized resource operations; previews do not place or reserve executions. */
public final class ResourceCatalogService {
    private final JdbcResourceRepository repository;
    private final AccessPolicy access;
    public ResourceCatalogService(JdbcResourceRepository repository,AccessPolicy access) { this.repository=repository;this.access=access; }
    private void authorize(Actor actor,String namespace,Action action) { access.require(actor,namespace,action);identifier(namespace,"namespace"); }
    public Cluster putCluster(Actor actor,String namespace,String id,Cluster value) {
        authorize(actor,namespace,Action.WRITE);identifier(id,"cluster id");
        if(value==null || !id.equals(value.id()) || value.kind()==null) throw ResourceException.invalid("cluster id must match route and kind is required");
        return repository.putCluster(namespace,value);
    }
    public Cluster cluster(Actor actor,String namespace,String id) {
        authorize(actor,namespace,Action.READ);identifier(id,"cluster id");return repository.cluster(namespace,id);
    }
    public List<Cluster> clusters(Actor actor,String namespace,int limit,int offset) {
        authorize(actor,namespace,Action.READ);page(limit,offset);return repository.clusters(namespace,limit,offset);
    }
    public DatasetVersion registerDataset(Actor actor,String namespace,String id,String version,DatasetVersion value) {
        authorize(actor,namespace,Action.WRITE);identifier(id,"dataset id");token(version,"version",100);
        if(value==null || !id.equals(value.datasetId()) || !version.equals(value.version())) throw ResourceException.invalid("dataset id/version must match route");
        token(value.format(),"format",64);
        if(value.locations().isEmpty() || value.locations().size()>100) throw ResourceException.invalid("requires 1..100 dataset locations");
        var seen=new HashSet<String>();
        for(var location:value.locations()) {
            identifier(location.clusterId(),"cluster id");
            if(!seen.add(location.clusterId())) throw ResourceException.invalid("duplicate dataset location for cluster");
            objectUri(location.uri());repository.cluster(namespace,location.clusterId());
        }
        var normalized=new DatasetVersion(id,version,value.format(),value.locations().stream().sorted(Comparator.comparing(Location::clusterId)).toList());
        return repository.register(namespace,normalized);
    }
    public DatasetVersion dataset(Actor actor,String namespace,String id,String version) {
        authorize(actor,namespace,Action.READ);identifier(id,"dataset id");token(version,"version",100);return repository.dataset(namespace,id,version);
    }
    public List<DatasetVersion> datasets(Actor actor,String namespace,int limit,int offset) {
        authorize(actor,namespace,Action.READ);page(limit,offset);return repository.datasets(namespace,limit,offset);
    }
    public List<PlacementOption> placementOptions(Actor actor,String namespace,PlacementRequest request) {
        authorize(actor,namespace,Action.READ);
        if(request==null || request.candidateClusterIds().isEmpty() || request.candidateClusterIds().size()>100 || request.datasets().size()>100)
            throw ResourceException.invalid("requires 1..100 candidate clusters and at most 100 datasets");
        if(new HashSet<>(request.candidateClusterIds()).size()!=request.candidateClusterIds().size()) throw ResourceException.invalid("duplicate candidate cluster");
        request.candidateClusterIds().forEach(id->identifier(id,"cluster id"));
        var versions=new ArrayList<DatasetVersion>();var seen=new HashSet<List<String>>();
        for(var required:request.datasets()) {
            identifier(required.datasetId(),"dataset id");token(required.version(),"version",100);
            if(required.requiredFormat()!=null) token(required.requiredFormat(),"requiredFormat",64);
            if(!seen.add(List.of(required.datasetId(),required.version()))) throw ResourceException.invalid("duplicate dataset requirement");
            versions.add(repository.dataset(namespace,required.datasetId(),required.version()));
        }
        var options=new ArrayList<PlacementOption>();
        for(String id:request.candidateClusterIds()) {
            var cluster=repository.cluster(namespace,id);var reasons=new ArrayList<String>();var located=new ArrayList<DatasetLocation>();
            if(!cluster.enabled()) reasons.add("CLUSTER_DISABLED");
            for(int i=0;i<versions.size();i++) {
                var value=versions.get(i);var required=request.datasets().get(i);String key=value.datasetId()+"/"+value.version();
                if(required.requiredFormat()!=null && !required.requiredFormat().equals(value.format())) reasons.add("FORMAT_MISMATCH:"+key);
                var location=value.locations().stream().filter(l->l.clusterId().equals(id)).findFirst();
                if(location.isEmpty()) reasons.add("DATASET_NOT_LOCAL:"+key);
                else located.add(new DatasetLocation(value.datasetId(),value.version(),value.format(),location.get().uri()));
            }
            options.add(new PlacementOption(id,cluster.kind(),reasons.isEmpty(),List.copyOf(reasons),List.copyOf(located)));
        }
        return List.copyOf(options);
    }
    private static void identifier(String value,String field) {
        if(value==null || !value.matches("[A-Za-z][A-Za-z0-9_.-]{0,99}")) throw ResourceException.invalid("invalid "+field);
    }
    private static void token(String value,String field,int max) {
        if(value==null || value.length()>max || !value.matches("[A-Za-z0-9][A-Za-z0-9_.-]*")) throw ResourceException.invalid("invalid "+field);
    }
    private static void page(int limit,int offset) {
        if(limit<1 || limit>100 || offset<0 || offset>1_000_000) throw ResourceException.invalid("limit 1..100, offset 0..1000000 required");
    }
    private static void objectUri(String value) {
        try {
            if(value==null || value.length()>2048) throw new IllegalArgumentException();
            var uri=URI.create(value);
            if(!"s3".equals(uri.getScheme()) || uri.getHost()==null || uri.getUserInfo()!=null || uri.getPort()!=-1 || uri.getQuery()!=null || uri.getFragment()!=null
                    || uri.getPath()==null || uri.getPath().length()<2 || Arrays.asList(uri.getPath().split("/")).contains("..")) throw new IllegalArgumentException();
        } catch(IllegalArgumentException ex) { throw ResourceException.invalid("location requires s3://bucket/key without credentials, query or parent traversal"); }
    }
}
