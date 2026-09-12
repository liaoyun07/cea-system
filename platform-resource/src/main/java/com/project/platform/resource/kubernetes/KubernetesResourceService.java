package com.project.platform.resource.kubernetes;

import com.project.platform.foundation.identity.AccessPolicy.Actor;
import com.project.platform.resource.catalog.ResourceCatalogService;
import com.project.platform.resource.catalog.ResourceException;
import io.fabric8.kubernetes.api.model.*;
import io.fabric8.kubernetes.client.*;
import java.util.*;
import java.util.function.Function;

/** Live, read-only inventory. Does not reserve resources or reconcile workload state. */
public final class KubernetesResourceService {
    public record Page<T>(String namespace,List<T> items,String continueToken) {}
    public record NodeView(String name,String ready,boolean unschedulable,List<String> addresses,
                           Map<String,String> capacity,Map<String,String> allocatable) {}
    public record ServiceView(String name,String type,String clusterIP,List<String> ports,String createdAt) {}
    public record NamespaceView(String name,String phase,String createdAt) {}
    public static final class Unavailable extends RuntimeException {
        public Unavailable(String message) { super(message); }
    }
    private final ResourceCatalogService resources;
    private final KubernetesConnections connections;
    public KubernetesResourceService(ResourceCatalogService resources,KubernetesConnections connections) {
        this.resources=resources;this.connections=connections;
    }
    private <T>T read(Actor actor,String namespace,String cluster,Function<KubernetesClient,T> query) {
        resources.cluster(actor,namespace,cluster);
        try(var client=connections.open(namespace,cluster)) { return query.apply(client); }
        catch(KubernetesClientException ex) {
            if(ex.getCode()==410) throw ResourceException.conflict("Kubernetes page expired; refresh the resource list");
            throw new Unavailable(ex.getCode()==403 ? "Kubernetes read permission denied; check configured RBAC" : "Kubernetes resource query failed; check cluster connection");
        }
    }
    private static ListOptions options(int limit,String token) {
        if(limit<1 || limit>100 || (token!=null && token.length()>16384)) throw ResourceException.invalid("limit must be 1..100 and continueToken at most 16384 characters");
        return new ListOptionsBuilder().withLimit((long)limit).withContinue(token==null || token.isBlank()?null:token).build();
    }
    public Page<NodeView> nodes(Actor actor,String namespace,String cluster,int limit,String token) {
        return read(actor,namespace,cluster,client->{
            var list=client.nodes().list(options(limit,token));
            return new Page<>(client.getNamespace(),list.getItems().stream().map(node->{
                var status=node.getStatus();
                String ready=status==null || status.getConditions()==null ? "Unknown" : status.getConditions().stream()
                        .filter(c->"Ready".equals(c.getType())).map(NodeCondition::getStatus).findFirst().orElse("Unknown");
                return new NodeView(node.getMetadata().getName(),ready,node.getSpec()!=null && Boolean.TRUE.equals(node.getSpec().getUnschedulable()),
                        status==null || status.getAddresses()==null ? List.of() : status.getAddresses().stream().map(a->a.getType()+": "+a.getAddress()).toList(),
                        quantities(status==null?null:status.getCapacity()),quantities(status==null?null:status.getAllocatable()));
            }).toList(),list.getMetadata().getContinue());
        });
    }
    private static Map<String,String> quantities(Map<String,Quantity> values) {
        var result=new LinkedHashMap<String,String>();
        if(values!=null) for(String name:List.of("cpu","memory","pods")) if(values.get(name)!=null) result.put(name,values.get(name).toString());
        return result;
    }
    public Page<ServiceView> services(Actor actor,String namespace,String cluster,int limit,String token) {
        return read(actor,namespace,cluster,client->{
            var list=client.services().inNamespace(client.getNamespace()).list(options(limit,token));
            return new Page<>(client.getNamespace(),list.getItems().stream().map(service->{
                var spec=service.getSpec();
                return new ServiceView(service.getMetadata().getName(),spec==null?null:spec.getType(),spec==null?null:spec.getClusterIP(),
                        spec==null || spec.getPorts()==null ? List.of() : spec.getPorts().stream().map(p->p.getPort()+"/"+p.getProtocol()+" → "+(p.getTargetPort()==null?p.getPort():p.getTargetPort().getValue())).toList(),
                        service.getMetadata().getCreationTimestamp());
            }).toList(),list.getMetadata().getContinue());
        });
    }
    public NamespaceView namespace(Actor actor,String namespace,String cluster) {
        return read(actor,namespace,cluster,client->{
            var value=client.namespaces().withName(client.getNamespace()).get();
            if(value==null) throw ResourceException.missing("configured Kubernetes namespace does not exist");
            return new NamespaceView(value.getMetadata().getName(),value.getStatus()==null?null:value.getStatus().getPhase(),value.getMetadata().getCreationTimestamp());
        });
    }
}
