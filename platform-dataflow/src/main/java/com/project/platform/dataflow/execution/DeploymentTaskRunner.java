package com.project.platform.dataflow.execution;

import com.project.platform.deployment.application.ApplicationException;
import com.project.platform.deployment.service.DeploymentService;
import com.project.platform.foundation.identity.AccessPolicy.Actor;
import com.project.platform.resource.kubernetes.KubernetesConnections;
import com.project.platform.resource.kubernetes.KubernetesManagementService;
import com.project.platform.runtime.definition.BindingResolver;
import com.project.platform.runtime.definition.FlowValidator;
import com.project.platform.runtime.model.WorkflowException;
import com.project.platform.runtime.worker.*;
import java.util.*;
import java.util.function.Function;

/** A finite deployment step; Kubernetes owns the service after the workflow finishes. */
public final class DeploymentTaskRunner implements TaskRunner {
    private final DeploymentService deployments;
    private final KubernetesManagementService management;
    private final KubernetesConnections connections;
    private final BindingResolver bindings;
    private final Function<WorkerJob,Actor> identities;
    public DeploymentTaskRunner(DeploymentService deployments,KubernetesManagementService management,KubernetesConnections connections,
                                BindingResolver bindings,Function<WorkerJob,Actor> identities) {
        this.deployments=deployments;this.management=management;this.connections=connections;this.bindings=bindings;this.identities=identities;
    }
    @Override public WorkerJob.Result run(TaskContext context) throws Exception {
        try {return deploy(context);}
        catch(InterruptedException ex){throw ex;}
        catch(ApplicationException | com.project.platform.resource.catalog.ResourceException | com.project.platform.resource.kubernetes.KubernetesResourceService.Unavailable | WorkflowException ex) {
            return WorkerJob.Result.failed(ex.getMessage());
        } catch(Exception ex) {return WorkerJob.Result.failed("deployment task failed ("+ex.getClass().getSimpleName()+")");}
    }
    private WorkerJob.Result deploy(TaskContext context) throws Exception {
        var job=context.job();var c=job.task().container();var d=job.task().deployment();
        var actor=identities.apply(job);
        String workspace=(String)((Map<?,?>)job.context().get("execution")).get("namespace");
        var candidates=FlowValidator.candidateClusters(bindings.resolve(c.candidateClusters(),job.context()));
        if(candidates.size()!=1)throw WorkflowException.invalid("candidateClusters","Deployment requires exactly one target cluster");
        String cluster=candidates.getFirst(),namespace=d.kubeNamespace();
        if(namespace==null)try(var client=connections.open(workspace,cluster)){namespace=client.getNamespace();}
        if(context.cancellation()!=null)return WorkerJob.Result.failed(context.cancellation());
        if(context.prepared()==null) {
            var parameters=new LinkedHashMap<String,Object>();
            c.parameters().forEach((name,binding)->parameters.put(name,bindings.resolve(binding,job.context())));
            String version=null;
            try {version=deployments.get(actor,workspace,cluster,namespace,d.name()).resourceVersion();}
            catch(ApplicationException ex) {if(ex.kind()!=ApplicationException.Kind.NOT_FOUND)throw ex;}
            var limits=c.resources()==null?null:c.resources().limits();
            // Kubernetes defaults requests to limits, as it does for the existing Application Job task.
            var resources=limits==null?null:new DeploymentService.Resources(limits.cpu(),limits.memory(),limits.cpu(),limits.memory());
            var readiness=d.readiness()==null?null:new DeploymentService.Readiness(d.readiness().path(),d.readiness().port());
            context.check();
            var saved=deployments.put(actor,workspace,cluster,namespace,d.name(),new DeploymentService.Request(
                    c.applicationId(),c.version(),d.replicas(),parameters,c.command(),version,readiness,resources));
            context.prepare(saved.latestOperation().id());
        }
        if(context.cancellation()!=null)return WorkerJob.Result.failed(context.cancellation());
        if(d.service()!=null) {
            var s=d.service();
            management.putService(actor,workspace,cluster,namespace,new KubernetesManagementService.ServiceRequest(d.name(),s.nodePort()==null?"ClusterIP":"NodePort",
                    Map.of("cea-system/owner","cea-system","cea-system/namespace",workspace,"cea-system/deployment",d.name()),
                    List.of(new KubernetesManagementService.Port("http",s.port(),s.targetPort().toString(),"TCP",s.nodePort()))));
        }
        while(true) {
            if(context.cancellation()!=null)return WorkerJob.Result.failed(context.cancellation());
            var current=deployments.get(actor,workspace,cluster,namespace,d.name());
            if(current.latestOperation()!=null && !context.prepared().equals(current.latestOperation().id()))
                return WorkerJob.Result.failed("deployment was changed by another operation");
            if(current.conditions().contains("Progressing:False:ProgressDeadlineExceeded"))return WorkerJob.Result.failed("deployment rollout exceeded its deadline");
            if(deployments.ready(actor,workspace,cluster,namespace,d.name()))
                return WorkerJob.Result.success(Map.of("endpoint",d.service()==null?"":Objects.toString(d.service().endpoint(),"")));
            Thread.sleep(1000);
        }
    }
}
