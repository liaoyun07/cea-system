package com.project.platform.resource.kubernetes;

import com.project.platform.foundation.identity.AccessPolicy.Actor;
import com.project.platform.resource.catalog.ResourceCatalogService;
import com.project.platform.resource.catalog.ResourceException;
import io.fabric8.kubernetes.api.model.*;
import io.fabric8.kubernetes.client.*;
import java.util.*;
import java.util.function.Function;
import java.time.Clock;
import java.time.Instant;

/** Live, read-only inventory. Does not reserve resources or reconcile workload state. */
public final class KubernetesResourceService {
    public record Page<T>(String namespace,List<T> items,String continueToken) {}
    public record NodeView(String name,String ready,boolean unschedulable,List<String> addresses,
                           Map<String,String> capacity,Map<String,String> allocatable) {}
    public record ServiceView(String name,String type,String clusterIP,List<String> ports,String createdAt) {}
    public record NamespaceView(String name,String phase,String createdAt) {}
    public record Usage(Double cpuCores,Long memoryBytes,Double cpuPercent,Double memoryPercent,
                        String timestamp,String window,String status) {}
    public record NodeUsage(String name,Usage usage) {}
    public record ClusterUsage(String namespace,List<NodeUsage> nodes,Double cpuPercent,Double memoryPercent) {}
    public record ContainerUsage(String pod,String container,Usage usage) {}
    public static final class Unavailable extends RuntimeException {
        public Unavailable(String message) { super(message); }
    }
    private final ResourceCatalogService resources;
    private final KubernetesConnections connections;
    private final Clock clock;
    public KubernetesResourceService(ResourceCatalogService resources,KubernetesConnections connections,Clock clock) {
        this.resources=resources;this.connections=connections;this.clock=clock;
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
    public ClusterUsage nodeUsage(Actor actor,String namespace,String cluster) {
        return read(actor,namespace,cluster,client->{
            var metrics=client.top().nodes().metrics().getItems();
            var result=new ArrayList<NodeUsage>();double cpu=0,memory=0,cpuCapacity=0,memoryCapacity=0;boolean complete=true;
            for(var node:client.nodes().list().getItems()) {
                var metric=metrics.stream().filter(m->m.getMetadata().getName().equals(node.getMetadata().getName())).findFirst().orElse(null);
                var capacity=node.getStatus()==null?null:node.getStatus().getCapacity();
                Usage usage=usage(metric==null?null:metric.getUsage(),capacity,metric==null?null:metric.getTimestamp(),metric==null?null:metric.getWindow());
                result.add(new NodeUsage(node.getMetadata().getName(),usage));
                Double c=amount(capacity,"cpu"),m=amount(capacity,"memory");
                if(!"AVAILABLE".equals(usage.status()) || c==null || c<=0 || m==null || m<=0)complete=false;
                else { cpu+=usage.cpuCores();memory+=usage.memoryBytes();cpuCapacity+=c;memoryCapacity+=m; }
            }
            return new ClusterUsage(client.getNamespace(),result,complete?percent(cpu,cpuCapacity):null,complete?percent(memory,memoryCapacity):null);
        });
    }
    public List<ContainerUsage> podUsage(Actor actor,String namespace,String cluster) {
        return read(actor,namespace,cluster,client->{
            String kubeNamespace=client.getNamespace();
            var metrics=client.top().pods().inNamespace(kubeNamespace).metrics().getItems();
            var result=new ArrayList<ContainerUsage>();
            for(var pod:client.pods().inNamespace(kubeNamespace).list().getItems()) {
                var metric=metrics.stream().filter(m->kubeNamespace.equals(m.getMetadata().getNamespace()) && m.getMetadata().getName().equals(pod.getMetadata().getName())).findFirst().orElse(null);
                for(var container:pod.getSpec().getContainers()) {
                    var measured=metric==null || metric.getContainers()==null?null:metric.getContainers().stream().filter(c->c.getName().equals(container.getName())).findFirst().orElse(null);
                    result.add(new ContainerUsage(pod.getMetadata().getName(),container.getName(),usage(measured==null?null:measured.getUsage(),
                            container.getResources()==null?null:container.getResources().getLimits(),metric==null?null:metric.getTimestamp(),metric==null?null:metric.getWindow())));
                }
            }
            return result;
        });
    }
    private Usage usage(Map<String,Quantity> values,Map<String,Quantity> denominator,String timestamp,io.fabric8.kubernetes.api.model.Duration window) {
        Double cpu=amount(values,"cpu"),memory=amount(values,"memory");String state="AVAILABLE";
        try {
            Instant at=Instant.parse(timestamp),now=clock.instant();
            if(at.isBefore(now.minusSeconds(120)))state="STALE";
            else if(at.isAfter(now.plusSeconds(10)) || window==null || window.getDuration().isZero() || window.getDuration().isNegative())state="INVALID";
            else if(cpu==null || memory==null || memory>Long.MAX_VALUE)state="MISSING";
        } catch(RuntimeException ex) { state="MISSING"; }
        String interval=window==null || window.getDuration()==null?null:window.getDuration().toString();
        if(!"AVAILABLE".equals(state))return new Usage(null,null,null,null,timestamp,interval,state);
        return new Usage(cpu,memory.longValue(),percent(cpu,amount(denominator,"cpu")),percent(memory,amount(denominator,"memory")),timestamp,interval,state);
    }
    private static Double amount(Map<String,Quantity> quantities,String key) {
        try {
            double value=quantities.get(key).getNumericalAmount().doubleValue();
            return Double.isFinite(value) && value>=0?value:null;
        } catch(RuntimeException ex) { return null; }
    }
    private static Double percent(Double used,Double total) { return used==null || total==null || total<=0?null:used/total*100; }
}
