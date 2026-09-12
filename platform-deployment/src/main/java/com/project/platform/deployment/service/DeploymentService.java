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
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.*;

/** Kubernetes owns desired/observed Deployment state. No duplicate database deployment state machine. */
public final class DeploymentService {
    private static final String OWNER="cea-system";
    private static final String PREFIX="cea-system/";
    public record Readiness(String path,Integer port) {}
    public record Request(String applicationId,String version,Integer replicas,Map<String,Object> parameters,
                          List<String> command,String resourceVersion,Readiness readiness) {
        public Request { parameters=parameters==null?Map.of():Map.copyOf(parameters);command=command==null?List.of():List.copyOf(command); }
    }
    public record ScaleRequest(Integer replicas,String resourceVersion) {}
    public record Configuration(String applicationId,String version,int replicas,Map<String,Object> parameters,
                                List<String> command,String resourceVersion,Readiness readiness) {}
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
                    && Objects.equals(current.readiness(),request.readiness()))
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
                parameters.forEach((key,value)->env.add(new EnvVar(key,value.toString(),null)));container.setEnv(env);
                if(current==null || !Objects.equals(current.readiness(),request.readiness()))
                    container.setReadinessProbe(probe(request.readiness(),container.getReadinessProbe()));
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
                Object parsed=switch(contract.type()) {
                    case STRING -> env.getValue();
                    case INTEGER -> Long.valueOf(env.getValue());
                    case NUMBER -> new BigDecimal(env.getValue()).stripTrailingZeros();
                    case BOOLEAN -> { if(!"true".equals(env.getValue()) && !"false".equals(env.getValue()))throw new IllegalArgumentException();yield Boolean.valueOf(env.getValue()); }
                };
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
                Optional.ofNullable(container.getCommand()).orElse(List.of()),value.getMetadata().getResourceVersion(),readiness);
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
