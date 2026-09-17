package com.project.platform.deployment.service;

import com.project.platform.deployment.application.*;
import com.project.platform.deployment.distribution.ImageDistributionService;
import com.project.platform.foundation.identity.AccessPolicy;
import com.project.platform.foundation.identity.AccessPolicy.*;
import com.project.platform.resource.catalog.ResourceCatalogService;
import com.project.platform.resource.kubernetes.KubernetesConnections;
import io.fabric8.kubernetes.api.model.*;
import io.fabric8.kubernetes.api.model.apps.*;
import io.fabric8.kubernetes.client.KubernetesClient;
import io.fabric8.kubernetes.client.KubernetesClientException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.*;

/** Kubernetes owns desired/observed Deployment state. No duplicate database deployment state machine. */
public final class DeploymentService {
    private static final String OWNER="cea-system";
    private static final String PREFIX="cea-system/";
    public record Readiness(String path,Integer port) {}
    public record Resources(String cpuRequest,String memoryRequest,String cpuLimit,String memoryLimit) {}
    public record Request(String applicationId,String version,Integer replicas,Map<String,Object> parameters,
                          List<String> command,String resourceVersion,Readiness readiness,Resources resources) {
        public Request { parameters=parameters==null?Map.of():Map.copyOf(parameters);command=command==null?List.of():List.copyOf(command); }
        public Request(String applicationId,String version,Integer replicas,Map<String,Object> parameters,List<String> command,String resourceVersion,Readiness readiness) {
            this(applicationId,version,replicas,parameters,command,resourceVersion,readiness,null);
        }
    }
    public record ScaleRequest(Integer replicas,String resourceVersion) {}
    public record Configuration(String applicationId,String version,int replicas,Map<String,Object> parameters,
                                List<String> command,String resourceVersion,Readiness readiness,Resources resources) {}
    public record PodInstance(String name,String phase,boolean ready,String node,int restarts,List<String> reasons) {}
    public record RuntimeView(String namespace,Map<String,String> selector,Map<String,String> labels,List<PodInstance> pods) {}
    public record DeploymentRecord(String id,String applicationId,String version,String operation,int targetReplicas,
                                   String state,Instant startedAt,Instant finishedAt,Long durationMs,String error) {}
    public record View(String name,String clusterId,String applicationId,String version,String image,String resourceVersion,
                       int replicas,int readyReplicas,boolean observed,List<String> conditions,DeploymentRecord latestOperation) {}
    private final AccessPolicy access;
    private final ApplicationCatalogService applications;
    private final ResourceCatalogService resources;
    private final ImageDistributionService images;
    private final KubernetesConnections connections;
    private final JdbcDeploymentRecordRepository records;
    private final Clock clock;
    private final Duration timeout;
    public DeploymentService(AccessPolicy access,ApplicationCatalogService applications,ResourceCatalogService resources,
                             ImageDistributionService images,KubernetesConnections connections,
                             JdbcDeploymentRecordRepository records,Clock clock,Duration timeout) {
        this.access=access;this.applications=applications;this.resources=resources;this.images=images;this.connections=connections;
        this.records=records;this.clock=clock;this.timeout=timeout;
        if(timeout.compareTo(Duration.ofSeconds(30))<0 || timeout.compareTo(Duration.ofHours(1))>0)
            throw new IllegalArgumentException("deployment observation timeout must be 30 seconds..1 hour");
    }
    public View put(Actor actor,String namespace,String clusterId,String name,Request request) {
        access.require(actor,namespace,Action.WRITE);name(name);
        if(request==null || request.replicas()==null || request.replicas()<0 || request.replicas()>100 || request.command().size()>100
                || request.command().stream().anyMatch(v->v==null || v.length()>8192))throw ApplicationException.invalid("invalid deployment request");
        readiness(request.readiness());
        validateResources(request.resources());
        var app=applications.get(actor,namespace,request.applicationId(),request.version());
        var parameters=ApplicationContractValidator.parameters(app,request.parameters());
        if(!resources.cluster(actor,namespace,clusterId).enabled())throw ApplicationException.invalid("cluster is disabled");
        try(var client=connections.open(namespace,clusterId)) {
            var existing=client.apps().deployments().withName(name).get();
            if(existing!=null) {
                owned(existing,namespace);
                revision(existing,request.resourceVersion());
            } else if(request.resourceVersion()!=null)throw ApplicationException.conflict("deployment no longer exists");
            Configuration current=existing==null?null:configuration(actor,namespace,existing);
            if(current!=null && current.applicationId().equals(app.applicationId()) && current.version().equals(app.version())
                    && current.parameters().equals(parameters) && current.command().equals(request.command())
                    && Objects.equals(current.readiness(),request.readiness())
                    && (request.resources()==null || Objects.equals(current.resources(),normalized(request.resources()))))
                return scale(client,namespace,clusterId,existing,request.replicas());
            String id=begin(namespace,clusterId,name,app.applicationId(),app.version(),existing==null?"CREATE":"UPDATE",request.replicas());
            boolean submitted=false;
            try {
                String image=images.prepare(actor,namespace,app.applicationId(),app.version(),clusterId).image();
                var desired=existing==null?initial(client,name,namespace):new DeploymentBuilder(existing).build();
                desired.getSpec().setReplicas(request.replicas());
                var annotations=new HashMap<>(Optional.ofNullable(desired.getMetadata().getAnnotations()).orElse(Map.of()));
                annotations.put(PREFIX+"application",app.applicationId());annotations.put(PREFIX+"version",app.version());
                desired.getMetadata().setAnnotations(annotations);
                var container=container(desired);container.setImage(image);container.setCommand(request.command());
                var managed=new HashSet<>(app.parameters().keySet());
                if(current!=null)managed.addAll(applications.get(actor,namespace,current.applicationId(),current.version()).parameters().keySet());
                var env=new ArrayList<>(Optional.ofNullable(container.getEnv()).orElse(List.of()).stream().filter(e->!managed.contains(e.getName())).toList());
                parameters.forEach((key,value)->env.add(new EnvVar(key,ApplicationContractValidator.environmentValue(value),null)));container.setEnv(env);
                if(current==null || !Objects.equals(current.readiness(),request.readiness()))
                    container.setReadinessProbe(probe(request.readiness(),container.getReadinessProbe()));
                if(request.resources()!=null)applyResources(container,request.resources());
                submitted=true;
                Deployment saved=existing==null?client.apps().deployments().resource(desired).create():client.apps().deployments().resource(desired).lockResourceVersion(request.resourceVersion()).replace();
                records.submitted(id,saved.getMetadata().getUid(),saved.getMetadata().getGeneration(),clock.instant(),
                        existing==null || !Objects.equals(existing.getSpec(),desired.getSpec()));
                return view(saved,namespace,clusterId);
            } catch(RuntimeException ex) { failed(id,submitted,ex);throw ex; }
        }
    }
    private Deployment initial(KubernetesClient client,String name,String namespace) {
        var labels=Map.of(PREFIX+"owner",OWNER,PREFIX+"namespace",namespace,PREFIX+"deployment",name);
        return new DeploymentBuilder().withNewMetadata().withName(name).withNamespace(client.getNamespace()).withLabels(labels).endMetadata()
                .withNewSpec().withProgressDeadlineSeconds(600).withNewSelector().withMatchLabels(labels).endSelector()
                .withNewTemplate().withNewMetadata().withLabels(labels).endMetadata().withNewSpec().withAutomountServiceAccountToken(false)
                .addNewContainer().withName("application").withImagePullPolicy("IfNotPresent")
                .withNewSecurityContext().withAllowPrivilegeEscalation(false).withNewCapabilities().withDrop("ALL").endCapabilities().endSecurityContext()
                .endContainer().endSpec().endTemplate().endSpec().build();
    }
    public View scale(Actor actor,String namespace,String clusterId,String name,ScaleRequest request) {
        access.require(actor,namespace,Action.WRITE);name(name);
        if(request==null || request.replicas()==null || request.replicas()<0 || request.replicas()>100)throw ApplicationException.invalid("replicas must be explicitly supplied (0..100)");
        var cluster=resources.cluster(actor,namespace,clusterId);
        try(var client=connections.open(namespace,clusterId)) {
            var current=required(client,namespace,name);revision(current,request.resourceVersion());
            if(!cluster.enabled() && request.replicas()>current.getSpec().getReplicas())throw ApplicationException.invalid("cluster is disabled");
            return scale(client,namespace,clusterId,current,request.replicas());
        }
    }
    private View scale(KubernetesClient client,String namespace,String clusterId,Deployment current,int replicas) {
        if(current.getSpec().getReplicas()==replicas)return view(current,namespace,clusterId);
        var annotations=current.getMetadata().getAnnotations();
        String id=begin(namespace,clusterId,current.getMetadata().getName(),annotations.get(PREFIX+"application"),annotations.get(PREFIX+"version"),"SCALE",replicas);
        try {
            var desired=new DeploymentBuilder(current).editSpec().withReplicas(replicas).endSpec().build();
            var saved=client.apps().deployments().resource(desired).lockResourceVersion(current.getMetadata().getResourceVersion()).replace();
            records.submitted(id,saved.getMetadata().getUid(),saved.getMetadata().getGeneration(),clock.instant(),true);
            return view(saved,namespace,clusterId);
        } catch(RuntimeException ex) { failed(id,true,ex);throw ex; }
    }
    private String begin(String namespace,String cluster,String name,String app,String version,String operation,int replicas) {
        Instant now=clock.instant();return records.begin(namespace,cluster,name,app,version,operation,replicas,now,now.plus(timeout));
    }
    private void failed(String id,boolean submitted,RuntimeException ex) {
        boolean rejected=ex instanceof KubernetesClientException k && k.getCode()>=400 && k.getCode()<500;
        records.finish(id,submitted && !rejected?"UNKNOWN":"FAILED",
                submitted && !rejected?"submission outcome is unknown; inspect Kubernetes before retrying":"deployment request failed",clock.instant(),false);
    }
    public Configuration configuration(Actor actor,String namespace,String clusterId,String name) {
        access.require(actor,namespace,Action.READ);name(name);resources.cluster(actor,namespace,clusterId);
        try(var client=connections.open(namespace,clusterId)) { return configuration(actor,namespace,required(client,namespace,name)); }
    }
    private Configuration configuration(Actor actor,String namespace,Deployment value) {
        var annotations=value.getMetadata().getAnnotations();
        var app=applications.get(actor,namespace,annotations.get(PREFIX+"application"),annotations.get(PREFIX+"version"));
        var container=container(value);var parameters=new LinkedHashMap<String,Object>();
        for(var env:Optional.ofNullable(container.getEnv()).orElse(List.of())) {
            var contract=app.parameters().get(env.getName());if(contract==null)continue;
            if(env.getValueFrom()!=null || parameters.containsKey(env.getName()))throw ApplicationException.conflict("managed parameter is not a unique literal; edit Kubernetes configuration directly");
            try {
                Object parsed=ApplicationContractValidator.environmentParameter(env.getName(),contract,env.getValue());
                parameters.put(env.getName(),parsed);
            } catch(RuntimeException ex) { throw ApplicationException.conflict("managed parameter no longer matches its application contract"); }
        }
        var probe=container.getReadinessProbe();Readiness readiness=null;
        if(probe!=null) {
            var http=probe.getHttpGet();
            if(http==null || http.getPort()==null || http.getPort().getIntVal()==null || http.getHost()!=null
                    || (http.getScheme()!=null && !"HTTP".equals(http.getScheme())) || (http.getHttpHeaders()!=null && !http.getHttpHeaders().isEmpty()))
                throw ApplicationException.conflict("readiness probe is not editable by the HTTP path/port editor");
            readiness=new Readiness(http.getPath()==null?"/":http.getPath(),http.getPort().getIntVal());
        }
        return new Configuration(app.applicationId(),app.version(),value.getSpec().getReplicas(),parameters,
                Optional.ofNullable(container.getCommand()).orElse(List.of()),value.getMetadata().getResourceVersion(),readiness,resources(container));
    }
    /** Read only the Pods owned by this Deployment's ReplicaSets, including an old rolling revision. */
    public RuntimeView runtime(Actor actor,String namespace,String clusterId,String name) {
        access.require(actor,namespace,Action.READ);name(name);resources.cluster(actor,namespace,clusterId);
        try(var client=connections.open(namespace,clusterId)) {
            var deployment=required(client,namespace,name);
            var selector=deployment.getSpec().getSelector().getMatchLabels();
            var replicaSets=new HashSet<String>();
            client.apps().replicaSets().withLabels(selector).list().getItems().stream()
                    .filter(rs->ownedBy(rs.getMetadata(),deployment.getMetadata().getUid()))
                    .forEach(rs->replicaSets.add(rs.getMetadata().getUid()));
            var pods=client.pods().withLabels(selector).list().getItems().stream()
                    .filter(p->replicaSets.stream().anyMatch(uid->ownedBy(p.getMetadata(),uid)))
                    .sorted(Comparator.comparing(p->p.getMetadata().getName())).map(DeploymentService::podInstance).toList();
            return new RuntimeView(client.getNamespace(),selector,deployment.getSpec().getTemplate().getMetadata().getLabels(),pods);
        }
    }
    private static boolean ownedBy(ObjectMeta meta,String uid) {
        return Optional.ofNullable(meta.getOwnerReferences()).orElse(List.of()).stream()
                .anyMatch(owner->Boolean.TRUE.equals(owner.getController()) && uid.equals(owner.getUid()));
    }
    private static PodInstance podInstance(Pod pod) {
        var status=pod.getStatus();var reasons=new LinkedHashSet<String>();int restarts=0;boolean ready=false;
        if(status!=null) {
            if(status.getReason()!=null)reasons.add(status.getReason()+": "+Objects.toString(status.getMessage(),""));
            for(var condition:Optional.ofNullable(status.getConditions()).orElse(List.of())) {
                if("Ready".equals(condition.getType()) && "True".equals(condition.getStatus()))ready=true;
                if("False".equals(condition.getStatus()) && condition.getReason()!=null)
                    reasons.add(condition.getReason()+": "+Objects.toString(condition.getMessage(),""));
            }
            var containers=new ArrayList<ContainerStatus>(Optional.ofNullable(status.getInitContainerStatuses()).orElse(List.of()));
            containers.addAll(Optional.ofNullable(status.getContainerStatuses()).orElse(List.of()));
            for(var c:containers) {
                restarts+=c.getRestartCount()==null?0:c.getRestartCount();
                var state=c.getState();
                if(state!=null && state.getWaiting()!=null)reasons.add(c.getName()+": "+state.getWaiting().getReason()+" "+Objects.toString(state.getWaiting().getMessage(),""));
                var ended=state!=null && state.getTerminated()!=null?state.getTerminated():c.getLastState()==null?null:c.getLastState().getTerminated();
                if(ended!=null && ended.getExitCode()!=null && ended.getExitCode()!=0)
                    reasons.add(c.getName()+": "+Objects.toString(ended.getReason(),"Exited")+" (exit "+ended.getExitCode()+") "+Objects.toString(ended.getMessage(),""));
            }
        }
        return new PodInstance(pod.getMetadata().getName(),pod.getMetadata().getDeletionTimestamp()!=null?"Terminating":status==null?"Pending":status.getPhase(),
                ready,pod.getSpec().getNodeName(),restarts,List.copyOf(reasons));
    }
    private static String quantity(String value) { return value==null || value.isBlank()?null:value.trim(); }
    private static Resources normalized(Resources value) {
        return new Resources(quantity(value.cpuRequest()),quantity(value.memoryRequest()),quantity(value.cpuLimit()),quantity(value.memoryLimit()));
    }
    private static void validateResources(Resources value) {
        if(value==null)return;var v=normalized(value);
        resourcePair("CPU",v.cpuRequest(),v.cpuLimit());resourcePair("memory",v.memoryRequest(),v.memoryLimit());
    }
    private static void resourcePair(String name,String request,String limit) {
        try {
            var r=request==null?null:Quantity.getAmountInBytes(new Quantity(request));
            var l=limit==null?null:Quantity.getAmountInBytes(new Quantity(limit));
            if((r!=null && r.signum()<=0) || (l!=null && l.signum()<=0) || (r!=null && l!=null && r.compareTo(l)>0))
                throw new IllegalArgumentException();
        } catch(RuntimeException ex) { throw ApplicationException.invalid(name+" quantities must be positive and request must not exceed limit"); }
    }
    private static Resources resources(Container container) {
        var r=container.getResources();
        return new Resources(resourceValue(r==null?null:r.getRequests(),"cpu"),resourceValue(r==null?null:r.getRequests(),"memory"),
                resourceValue(r==null?null:r.getLimits(),"cpu"),resourceValue(r==null?null:r.getLimits(),"memory"));
    }
    private static String resourceValue(Map<String,Quantity> values,String key) {
        return values==null || values.get(key)==null?null:values.get(key).toString();
    }
    private static void applyResources(Container container,Resources value) {
        var v=normalized(value);var r=container.getResources()==null?new ResourceRequirements():container.getResources();
        r.setRequests(resourceMap(r.getRequests(),v.cpuRequest(),v.memoryRequest()));
        r.setLimits(resourceMap(r.getLimits(),v.cpuLimit(),v.memoryLimit()));container.setResources(r);
    }
    private static Map<String,Quantity> resourceMap(Map<String,Quantity> original,String cpu,String memory) {
        var values=new HashMap<String,Quantity>(original==null?Map.of():original);
        if(cpu==null)values.remove("cpu");else values.put("cpu",new Quantity(cpu));
        if(memory==null)values.remove("memory");else values.put("memory",new Quantity(memory));
        return values;
    }
    public List<DeploymentRecord> history(Actor actor,String namespace,String clusterId,String name,int limit,int offset) {
        access.require(actor,namespace,Action.READ);name(name);resources.cluster(actor,namespace,clusterId);
        if(limit<1 || limit>100 || offset<0)throw ApplicationException.invalid("invalid pagination");
        return records.list(namespace,clusterId,name,limit,offset);
    }
    public View get(Actor actor,String namespace,String clusterId,String name) {
        access.require(actor,namespace,Action.READ);name(name);resources.cluster(actor,namespace,clusterId);
        try(var client=connections.open(namespace,clusterId)) { return view(required(client,namespace,name),namespace,clusterId); }
    }
    public List<View> list(Actor actor,String namespace,String clusterId) {
        access.require(actor,namespace,Action.READ);resources.cluster(actor,namespace,clusterId);
        try(var client=connections.open(namespace,clusterId)) {
            return client.apps().deployments().withLabel(PREFIX+"owner",OWNER).withLabel(PREFIX+"namespace",namespace).list().getItems().stream().map(d->view(d,namespace,clusterId)).toList();
        }
    }
    public void delete(Actor actor,String namespace,String clusterId,String name,String resourceVersion) {
        access.require(actor,namespace,Action.WRITE);name(name);resources.cluster(actor,namespace,clusterId);
        try(var client=connections.open(namespace,clusterId)) {
            var existing=required(client,namespace,name);
            if(!existing.getMetadata().getResourceVersion().equals(resourceVersion))throw ApplicationException.conflict("deployment changed; read current resourceVersion before deleting");
            // A resourceVersion precondition prevents deletion by a stale request, including after recreation.
            client.apps().deployments().resource(existing).lockResourceVersion(resourceVersion).delete();
        }
    }
    private Deployment required(KubernetesClient client,String namespace,String name) {
        var value=client.apps().deployments().withName(name).get();
        if(value==null)throw ApplicationException.missing("deployment not found");owned(value,namespace);return value;
    }
    private void owned(Deployment deployment,String namespace) {
        var labels=deployment.getMetadata().getLabels();
        if(labels==null || !OWNER.equals(labels.get(PREFIX+"owner")) || !namespace.equals(labels.get(PREFIX+"namespace")))
            throw ApplicationException.conflict("resource is not a deployment owned by this namespace");
        if(deployment.getMetadata().getDeletionTimestamp()!=null)throw ApplicationException.conflict("deployment is being deleted");
    }
    private View view(Deployment value,String namespace,String clusterId) {
        var status=value.getStatus();var annotations=value.getMetadata().getAnnotations();
        var history=records.list(namespace,clusterId,value.getMetadata().getName(),1,0);
        return new View(value.getMetadata().getName(),clusterId,annotations.get(PREFIX+"application"),annotations.get(PREFIX+"version"),
                container(value).getImage(),value.getMetadata().getResourceVersion(),
                value.getSpec().getReplicas(),status==null || status.getReadyReplicas()==null?0:status.getReadyReplicas(),
                status!=null && status.getObservedGeneration()!=null && status.getObservedGeneration()>=value.getMetadata().getGeneration(),
                status==null || status.getConditions()==null?List.of():status.getConditions().stream().map(c->c.getType()+":"+c.getStatus()+":"+c.getReason()).toList(),history.isEmpty()?null:history.getFirst());
    }
    private static Container container(Deployment value) {
        return value.getSpec().getTemplate().getSpec().getContainers().stream().filter(c->"application".equals(c.getName())).findFirst()
                .orElseThrow(()->ApplicationException.conflict("managed application container missing"));
    }
    private static void revision(Deployment value,String revision) {
        if(!value.getMetadata().getResourceVersion().equals(revision))throw ApplicationException.conflict("deployment changed; read current resourceVersion before updating");
    }
    private static void readiness(Readiness value) {
        if(value!=null && (value.path()==null || !value.path().startsWith("/") || value.path().length()>1024 || value.path().chars().anyMatch(Character::isISOControl)
                || value.port()==null || value.port()<1 || value.port()>65535))throw ApplicationException.invalid("HTTP readiness path and port (1..65535) required");
    }
    private static Probe probe(Readiness value,Probe existing) {
        if(value==null)return null;
        var builder=existing==null?new ProbeBuilder().withPeriodSeconds(1).withTimeoutSeconds(1).withFailureThreshold(3):new ProbeBuilder(existing);
        return builder.withNewHttpGet().withPath(value.path()).withNewPort(value.port()).endHttpGet().build();
    }
    private static void name(String value) {
        if(value==null || !value.matches("[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?"))throw ApplicationException.invalid("Kubernetes deployment name required");
    }
}
