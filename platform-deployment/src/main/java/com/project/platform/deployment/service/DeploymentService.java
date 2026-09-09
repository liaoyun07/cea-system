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
import java.util.*;

/** Kubernetes owns desired/observed Deployment state. No duplicate database deployment state machine. */
public final class DeploymentService {
    private static final String OWNER="cea-system";
    private static final String PREFIX="cea-system/";
    public record Request(String applicationId,String version,int replicas,Map<String,Object> parameters,
                          List<String> command,String resourceVersion) {
        public Request { parameters=parameters==null?Map.of():Map.copyOf(parameters);command=command==null?List.of():List.copyOf(command); }
    }
    public record View(String name,String clusterId,String applicationId,String version,String image,String resourceVersion,
                       int replicas,int readyReplicas,boolean observed,List<String> conditions) {}
    private final AccessPolicy access;
    private final ApplicationCatalogService applications;
    private final ResourceCatalogService resources;
    private final ImageDistributionService images;
    private final KubernetesConnections connections;
    public DeploymentService(AccessPolicy access,ApplicationCatalogService applications,ResourceCatalogService resources,
                             ImageDistributionService images,KubernetesConnections connections) {
        this.access=access;this.applications=applications;this.resources=resources;this.images=images;this.connections=connections;
    }
    public View put(Actor actor,String namespace,String clusterId,String name,Request request) {
        access.require(actor,namespace,Action.WRITE);name(name);
        if(request==null || request.replicas()<0 || request.replicas()>100 || request.command().size()>100
                || request.command().stream().anyMatch(v->v==null || v.length()>8192))throw ApplicationException.invalid("invalid deployment request");
        var app=applications.get(actor,namespace,request.applicationId(),request.version());
        var parameters=ApplicationContractValidator.parameters(app,request.parameters());
        if(!resources.cluster(actor,namespace,clusterId).enabled())throw ApplicationException.invalid("cluster is disabled");
        try(var client=connections.open(namespace,clusterId)) {
            var existing=client.apps().deployments().withName(name).get();
            if(existing!=null) {
                owned(existing,namespace);
                if(!existing.getMetadata().getResourceVersion().equals(request.resourceVersion()))throw ApplicationException.conflict("deployment changed; read current resourceVersion before updating");
            } else if(request.resourceVersion()!=null)throw ApplicationException.conflict("deployment no longer exists");
            String image=images.prepare(actor,namespace,app.applicationId(),app.version(),clusterId).image();
            var labels=Map.of(PREFIX+"owner",OWNER,PREFIX+"namespace",namespace,PREFIX+"deployment",name);
            var env=parameters.entrySet().stream().map(e->new EnvVar(e.getKey(),e.getValue().toString(),null)).toList();
            var desired=new DeploymentBuilder().withNewMetadata().withName(name).withNamespace(client.getNamespace())
                    .withLabels(labels).withAnnotations(Map.of(PREFIX+"application",app.applicationId(),PREFIX+"version",app.version()))
                    .withResourceVersion(request.resourceVersion()).endMetadata()
                    .withNewSpec().withReplicas(request.replicas()).withNewSelector().withMatchLabels(labels).endSelector()
                    .withNewTemplate().withNewMetadata().withLabels(labels).endMetadata().withNewSpec()
                    .withAutomountServiceAccountToken(false)
                    .addNewContainer().withName("application").withImage(image).withImagePullPolicy("IfNotPresent")
                    .withCommand(request.command()).withEnv(env)
                    .withNewSecurityContext().withAllowPrivilegeEscalation(false).withNewCapabilities().withDrop("ALL").endCapabilities().endSecurityContext()
                    .endContainer().endSpec().endTemplate().endSpec().build();
            Deployment saved=existing==null?client.apps().deployments().resource(desired).create():client.apps().deployments().resource(desired).lockResourceVersion(request.resourceVersion()).replace();
            return view(saved,clusterId);
        }
    }
    public View get(Actor actor,String namespace,String clusterId,String name) {
        access.require(actor,namespace,Action.READ);name(name);resources.cluster(actor,namespace,clusterId);
        try(var client=connections.open(namespace,clusterId)) { return view(required(client,namespace,name),clusterId); }
    }
    public List<View> list(Actor actor,String namespace,String clusterId) {
        access.require(actor,namespace,Action.READ);resources.cluster(actor,namespace,clusterId);
        try(var client=connections.open(namespace,clusterId)) {
            return client.apps().deployments().withLabel(PREFIX+"owner",OWNER).withLabel(PREFIX+"namespace",namespace).list().getItems().stream().map(d->view(d,clusterId)).toList();
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
    }
    private View view(Deployment value,String clusterId) {
        var status=value.getStatus();var annotations=value.getMetadata().getAnnotations();
        return new View(value.getMetadata().getName(),clusterId,annotations.get(PREFIX+"application"),annotations.get(PREFIX+"version"),
                value.getSpec().getTemplate().getSpec().getContainers().getFirst().getImage(),value.getMetadata().getResourceVersion(),
                value.getSpec().getReplicas(),status==null || status.getReadyReplicas()==null?0:status.getReadyReplicas(),
                status!=null && status.getObservedGeneration()!=null && status.getObservedGeneration()>=value.getMetadata().getGeneration(),
                status==null || status.getConditions()==null?List.of():status.getConditions().stream().map(c->c.getType()+":"+c.getStatus()+":"+c.getReason()).toList());
    }
    private static void name(String value) {
        if(value==null || !value.matches("[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?"))throw ApplicationException.invalid("Kubernetes deployment name required");
    }
}
