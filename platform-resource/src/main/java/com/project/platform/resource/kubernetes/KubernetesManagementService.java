package com.project.platform.resource.kubernetes;

import com.project.platform.foundation.identity.AccessPolicy;
import com.project.platform.foundation.identity.AccessPolicy.*;
import com.project.platform.resource.catalog.ResourceCatalogService;
import com.project.platform.resource.catalog.ResourceException;
import io.fabric8.kubernetes.api.model.*;
import io.fabric8.kubernetes.client.*;
import java.util.*;
import java.util.function.Function;

/** Kubernetes owns these objects. Management never changes the execution namespace or placement. */
public final class KubernetesManagementService {
    public record NamespaceInfo(String name,String uid,String resourceVersion,String phase,boolean executionDefault,boolean managed,String createdAt) {}
    public record NamespaceRequest(String name) {}
    public record Port(String name,int port,String targetPort,String protocol,Integer nodePort) {}
    public record ServiceRequest(String name,String type,Map<String,String> selector,List<Port> ports) {}
    public record PodInfo(String name,String ip,String phase,boolean ready,String node) {}
    public record ServiceInfo(String name,String namespace,String uid,String resourceVersion,String type,String clusterIP,
                              Map<String,String> selector,List<Port> ports,List<String> externalAddresses,List<String> nodeAddresses,
                              List<PodInfo> pods,boolean managed,String createdAt) {}
    private static final String OWNER="cea-system/owner",WORKSPACE="cea-system/namespace";
    private final AccessPolicy access;
    private final ResourceCatalogService resources;
    private final KubernetesConnections connections;
    public KubernetesManagementService(AccessPolicy access,ResourceCatalogService resources,KubernetesConnections connections) {
        this.access=access;this.resources=resources;this.connections=connections;
    }
    private <T>T call(Actor actor,String namespace,String cluster,Action action,Function<KubernetesClient,T> work) {
        access.require(actor,namespace,action);resources.cluster(actor,namespace,cluster);
        try(var client=connections.open(namespace,cluster)) { return work.apply(client); }
        catch(KubernetesClientException ex) {
            if(ex.getCode()==409)throw ResourceException.conflict("Kubernetes resource changed or already exists; refresh before retrying");
            if(ex.getCode()==404)throw ResourceException.missing("Kubernetes resource not found");
            if(ex.getCode()==422)throw ResourceException.invalid("Kubernetes rejected the resource configuration");
            throw new KubernetesResourceService.Unavailable(ex.getCode()==403?"Kubernetes management permission denied; check configured RBAC":"Kubernetes management request failed; refresh to check the actual result");
        }
    }
    private static boolean owned(ObjectMeta meta,String namespace) {
        return meta.getLabels()!=null && "cea-system".equals(meta.getLabels().get(OWNER)) && namespace.equals(meta.getLabels().get(WORKSPACE));
    }
    private static boolean managedNamespace(Namespace value,String workspace) {
        return value!=null && value.getMetadata().getName().startsWith("cea-"+workspace+"-") && owned(value.getMetadata(),workspace);
    }
    private static void name(String value) {
        if(value==null || !value.matches("[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?"))throw ResourceException.invalid("requires a lowercase Kubernetes name of 1..63 characters");
    }
    private static Namespace allowed(KubernetesClient client,String workspace,String namespace) {
        name(namespace);
        var value=client.namespaces().withName(namespace).get();
        // Deliberately do not expose whether an out-of-scope namespace exists.
        if(!namespace.equals(client.getNamespace()) && !managedNamespace(value,workspace))throw new AccessPolicy.Forbidden();
        if(value==null)throw ResourceException.missing("Kubernetes namespace not found");
        return value;
    }
    private static void active(Namespace value) {
        if(value.getMetadata().getDeletionTimestamp()!=null)throw ResourceException.conflict("Kubernetes namespace is terminating");
    }
    private static NamespaceInfo namespaceInfo(Namespace value,String executionDefault,String workspace) {
        var m=value.getMetadata();return new NamespaceInfo(m.getName(),m.getUid(),m.getResourceVersion(),value.getStatus()==null?null:value.getStatus().getPhase(),
                m.getName().equals(executionDefault),owned(m,workspace),m.getCreationTimestamp());
    }
    public List<NamespaceInfo> namespaces(Actor actor,String workspace,String cluster) {
        return call(actor,workspace,cluster,Action.READ,client->{
            var values=new TreeMap<String,Namespace>();
            var initial=client.namespaces().withName(client.getNamespace()).get();
            if(initial!=null)values.put(initial.getMetadata().getName(),initial);
            client.namespaces().withLabels(Map.of(OWNER,"cea-system",WORKSPACE,workspace)).list().getItems().stream().filter(v->managedNamespace(v,workspace)).forEach(v->values.put(v.getMetadata().getName(),v));
            return values.values().stream().map(v->namespaceInfo(v,client.getNamespace(),workspace)).toList();
        });
    }
    public NamespaceInfo createNamespace(Actor actor,String workspace,String cluster,NamespaceRequest request) {
        return call(actor,workspace,cluster,Action.WRITE,client->{
            if(request==null)throw ResourceException.invalid("namespace name required");name(request.name());
            if(!request.name().startsWith("cea-"+workspace+"-") || request.name().equals(client.getNamespace()))
                throw ResourceException.invalid("managed namespace must start with cea-"+workspace+"- and differ from the execution default");
            var value=new NamespaceBuilder().withNewMetadata().withName(request.name()).withLabels(Map.of(OWNER,"cea-system",WORKSPACE,workspace)).endMetadata().build();
            return namespaceInfo(client.namespaces().resource(value).create(),client.getNamespace(),workspace);
        });
    }
    private static void expected(ObjectMeta meta,String uid,String version) {
        if(uid==null || version==null || !uid.equals(meta.getUid()) || !version.equals(meta.getResourceVersion()))
            throw ResourceException.conflict("resource identity or version changed; refresh before deleting");
    }
    public void deleteNamespace(Actor actor,String workspace,String cluster,String namespace,String uid,String version) {
        call(actor,workspace,cluster,Action.WRITE,client->{
            var value=allowed(client,workspace,namespace);
            if(namespace.equals(client.getNamespace()) || !owned(value.getMetadata(),workspace))throw ResourceException.conflict("cannot delete the execution default or an unmanaged namespace");
            expected(value.getMetadata(),uid,version);active(value);
            // A namespace delete is cascading. Workloads and persistent storage must be removed explicitly first.
            if(!client.pods().inNamespace(namespace).list().getItems().isEmpty()
                    || !client.replicationControllers().inNamespace(namespace).list().getItems().isEmpty()
                    || !client.apps().deployments().inNamespace(namespace).list().getItems().isEmpty()
                    || !client.apps().statefulSets().inNamespace(namespace).list().getItems().isEmpty()
                    || !client.apps().daemonSets().inNamespace(namespace).list().getItems().isEmpty()
                    || !client.apps().replicaSets().inNamespace(namespace).list().getItems().isEmpty()
                    || !client.batch().v1().jobs().inNamespace(namespace).list().getItems().isEmpty()
                    || !client.batch().v1().cronjobs().inNamespace(namespace).list().getItems().isEmpty()
                    || !client.persistentVolumeClaims().inNamespace(namespace).list().getItems().isEmpty())
                throw ResourceException.conflict("namespace still contains workloads or persistent volume claims");
            client.namespaces().resource(value).lockResourceVersion(version).delete();return null;
        });
    }
    public List<ServiceInfo> services(Actor actor,String workspace,String cluster,String namespace) {
        return call(actor,workspace,cluster,Action.READ,client->{
            allowed(client,workspace,namespace);
            return client.services().inNamespace(namespace).list().getItems().stream().map(s->serviceInfo(client,s,workspace,false)).toList();
        });
    }
    public ServiceInfo service(Actor actor,String workspace,String cluster,String namespace,String name) {
        return call(actor,workspace,cluster,Action.READ,client->{
            allowed(client,workspace,namespace);name(name);
            var value=client.services().inNamespace(namespace).withName(name).get();
            if(value==null)throw ResourceException.missing("Service not found");return serviceInfo(client,value,workspace,true);
        });
    }
    public ServiceInfo createService(Actor actor,String workspace,String cluster,String namespace,ServiceRequest request) {
        return call(actor,workspace,cluster,Action.WRITE,client->{
            active(allowed(client,workspace,namespace));
            if(request==null)throw ResourceException.invalid("Service configuration required");name(request.name());
            if(!Set.of("ClusterIP","NodePort","LoadBalancer").contains(Objects.toString(request.type(),"")))throw ResourceException.invalid("Service type must be ClusterIP, NodePort or LoadBalancer");
            if(request.selector()==null || request.selector().isEmpty() || request.selector().size()>20 || request.ports()==null || request.ports().isEmpty() || request.ports().size()>32)
                throw ResourceException.invalid("Service requires 1..20 selector labels and 1..32 ports");
            request.selector().forEach((k,v)->{if(k==null || k.length()>253 || v==null || v.length()>63)throw ResourceException.invalid("invalid selector label");});
            var ports=new ArrayList<ServicePort>();var seen=new HashSet<String>();
            for(var port:request.ports()) {
                if(port==null || port.port()<1 || port.port()>65535 || port.targetPort()==null)throw ResourceException.invalid("port must be 1..65535 and targetPort is required");
                IntOrString target;
                if(port.targetPort().matches("[0-9]{1,5}")) {
                    int number=Integer.parseInt(port.targetPort());if(number<1 || number>65535)throw ResourceException.invalid("targetPort must be 1..65535");target=new IntOrString(number);
                } else {
                    if(!port.targetPort().matches("[a-z]([-a-z0-9]{0,13}[a-z0-9])?"))throw ResourceException.invalid("targetPort must be a port number or port name");target=new IntOrString(port.targetPort());
                }
                String protocol=port.protocol()==null?"TCP":port.protocol();
                if(!Set.of("TCP","UDP","SCTP").contains(protocol) || !seen.add(protocol+":"+port.port()))throw ResourceException.invalid("invalid protocol or duplicate Service port");
                if(port.nodePort()!=null && (port.nodePort()<1 || port.nodePort()>65535 || "ClusterIP".equals(request.type())))throw ResourceException.invalid("nodePort is only valid for NodePort/LoadBalancer; omit for automatic allocation");
                ports.add(new ServicePortBuilder().withName(port.name()).withPort(port.port()).withTargetPort(target).withProtocol(protocol).withNodePort(port.nodePort()).build());
            }
            var value=new ServiceBuilder().withNewMetadata().withName(request.name()).withNamespace(namespace)
                    .withLabels(Map.of(OWNER,"cea-system",WORKSPACE,workspace)).endMetadata().withNewSpec()
                    .withType(request.type()).withSelector(request.selector()).withPorts(ports).endSpec().build();
            return serviceInfo(client,client.services().inNamespace(namespace).resource(value).create(),workspace,false);
        });
    }
    public void deleteService(Actor actor,String workspace,String cluster,String namespace,String name,String uid,String version) {
        call(actor,workspace,cluster,Action.WRITE,client->{
            allowed(client,workspace,namespace);name(name);
            var value=client.services().inNamespace(namespace).withName(name).get();
            if(value==null)throw ResourceException.missing("Service not found");
            if(!owned(value.getMetadata(),workspace))throw ResourceException.conflict("cannot delete an unmanaged Service");
            expected(value.getMetadata(),uid,version);client.services().inNamespace(namespace).resource(value).lockResourceVersion(version).delete();return null;
        });
    }
    private static ServiceInfo serviceInfo(KubernetesClient client,Service value,String workspace,boolean detail) {
        var m=value.getMetadata();var spec=value.getSpec();var pods=new ArrayList<PodInfo>();var addresses=new ArrayList<String>();var nodes=new ArrayList<String>();
        if(detail && spec.getSelector()!=null && !spec.getSelector().isEmpty())
            for(var pod:client.pods().inNamespace(m.getNamespace()).withLabels(spec.getSelector()).list().getItems()) {
                var status=pod.getStatus();boolean ready=status!=null && status.getConditions()!=null && status.getConditions().stream().anyMatch(c->"Ready".equals(c.getType()) && "True".equals(c.getStatus()));
                pods.add(new PodInfo(pod.getMetadata().getName(),status==null?null:status.getPodIP(),status==null?null:status.getPhase(),ready,pod.getSpec()==null?null:pod.getSpec().getNodeName()));
            }
        if(spec.getExternalIPs()!=null)addresses.addAll(spec.getExternalIPs());
        if(value.getStatus()!=null && value.getStatus().getLoadBalancer()!=null && value.getStatus().getLoadBalancer().getIngress()!=null)
            value.getStatus().getLoadBalancer().getIngress().forEach(i->{if(i.getIp()!=null)addresses.add(i.getIp());if(i.getHostname()!=null)addresses.add(i.getHostname());});
        if(detail && spec.getPorts().stream().anyMatch(p->p.getNodePort()!=null))
            for(var node:client.nodes().list().getItems())if(node.getStatus()!=null && node.getStatus().getAddresses()!=null)
                node.getStatus().getAddresses().forEach(a->nodes.add(a.getType()+": "+a.getAddress()));
        var ports=spec.getPorts().stream().map(p->new Port(p.getName(),p.getPort(),p.getTargetPort()==null?String.valueOf(p.getPort()):String.valueOf(p.getTargetPort().getValue()),p.getProtocol(),p.getNodePort())).toList();
        return new ServiceInfo(m.getName(),m.getNamespace(),m.getUid(),m.getResourceVersion(),spec.getType(),spec.getClusterIP(),spec.getSelector()==null?Map.of():spec.getSelector(),ports,addresses,nodes,pods,owned(m,workspace),m.getCreationTimestamp());
    }
    /** Includes desired templates at zero replicas, pending Pods and init containers; unavailable clusters fail closed. */
    public Set<String> workloadImages(Actor actor,String workspace) {
        var result=new HashSet<String>();
        for(String cluster:connections.clusterIds(workspace))call(actor,workspace,cluster,Action.READ,client->{
            for(var scope:namespaces(actor,workspace,cluster)) {
                String ns=scope.name();
                client.pods().inNamespace(ns).list().getItems().forEach(p->{
                    collectImages(p.getSpec(),result);
                    if(p.getStatus()!=null) {
                        collectImageIds(p.getStatus().getContainerStatuses(),result);
                        collectImageIds(p.getStatus().getInitContainerStatuses(),result);
                        collectImageIds(p.getStatus().getEphemeralContainerStatuses(),result);
                    }
                });
                client.replicationControllers().inNamespace(ns).list().getItems().forEach(p->{if(p.getSpec().getTemplate()!=null)collectImages(p.getSpec().getTemplate().getSpec(),result);});
                client.apps().deployments().inNamespace(ns).list().getItems().forEach(p->collectImages(p.getSpec().getTemplate().getSpec(),result));
                client.apps().statefulSets().inNamespace(ns).list().getItems().forEach(p->collectImages(p.getSpec().getTemplate().getSpec(),result));
                client.apps().daemonSets().inNamespace(ns).list().getItems().forEach(p->collectImages(p.getSpec().getTemplate().getSpec(),result));
                client.apps().replicaSets().inNamespace(ns).list().getItems().forEach(p->collectImages(p.getSpec().getTemplate().getSpec(),result));
                client.batch().v1().jobs().inNamespace(ns).list().getItems().forEach(p->collectImages(p.getSpec().getTemplate().getSpec(),result));
                client.batch().v1().cronjobs().inNamespace(ns).list().getItems().forEach(p->collectImages(p.getSpec().getJobTemplate().getSpec().getTemplate().getSpec(),result));
            }return null;
        });
        return Set.copyOf(result);
    }
    private static void collectImages(PodSpec spec,Set<String> target) {
        if(spec==null)return;
        if(spec.getContainers()!=null)spec.getContainers().forEach(c->target.add(c.getImage()));
        if(spec.getInitContainers()!=null)spec.getInitContainers().forEach(c->target.add(c.getImage()));
        if(spec.getEphemeralContainers()!=null)spec.getEphemeralContainers().forEach(c->target.add(c.getImage()));
    }
    private static void collectImageIds(List<ContainerStatus> statuses,Set<String> target) {
        if(statuses==null)return;
        for(var status:statuses)if(status.getImageID()!=null && !status.getImageID().isBlank()) {
            String image=status.getImageID();int scheme=image.indexOf("://");target.add(scheme<0?image:image.substring(scheme+3));
        }
    }
    public boolean applicationInUse(Actor actor,String workspace,String id,String version) {
        for(String cluster:connections.clusterIds(workspace)) {
            boolean found=call(actor,workspace,cluster,Action.READ,client->{
                for(var scope:namespaces(actor,workspace,cluster))
                    for(var value:client.apps().deployments().inNamespace(scope.name()).list().getItems()) {
                        var annotations=value.getMetadata().getAnnotations();
                        if(owned(value.getMetadata(),workspace) && annotations!=null && id.equals(annotations.get("cea-system/application")) && version.equals(annotations.get("cea-system/version")))return true;
                    }
                return false;
            });
            if(found)return true;
        }return false;
    }
}
