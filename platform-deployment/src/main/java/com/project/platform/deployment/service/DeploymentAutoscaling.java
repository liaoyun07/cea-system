package com.project.platform.deployment.service;

import com.project.platform.deployment.application.ApplicationException;
import io.fabric8.kubernetes.api.model.Quantity;
import io.fabric8.kubernetes.api.model.apps.Deployment;
import io.fabric8.kubernetes.api.model.autoscaling.v2.*;
import io.fabric8.kubernetes.client.KubernetesClient;
import java.util.*;

/** Maps the deployment editor to native HPA objects; Kubernetes alone controls replicas. */
public final class DeploymentAutoscaling {
    private DeploymentAutoscaling() {}
    public record Request(Integer minReplicas,Integer maxReplicas,Integer cpuUtilization,Integer memoryUtilization,String resourceVersion) {}
    public record Metric(String resource,Integer targetUtilization,Integer currentUtilization) {}
    public record View(boolean enabled,boolean editable,String name,String resourceVersion,Integer minReplicas,Integer maxReplicas,
                       Integer currentReplicas,Integer desiredReplicas,String lastScaleTime,List<Metric> metrics,List<String> conditions) {}

    static List<HorizontalPodAutoscaler> find(KubernetesClient client,Deployment deployment) {
        return client.autoscaling().v2().horizontalPodAutoscalers().inNamespace(deployment.getMetadata().getNamespace()).list().getItems().stream()
                .filter(h->"Deployment".equals(h.getSpec().getScaleTargetRef().getKind())
                        && "apps/v1".equals(h.getSpec().getScaleTargetRef().getApiVersion())
                        && deployment.getMetadata().getName().equals(h.getSpec().getScaleTargetRef().getName())).toList();
    }
    private static boolean owned(HorizontalPodAutoscaler h,Deployment d) {
        return "cea-system".equals(Optional.ofNullable(h.getMetadata().getLabels()).orElse(Map.of()).get("cea-system/owner"))
                && Optional.ofNullable(h.getMetadata().getOwnerReferences()).orElse(List.of()).stream()
                .anyMatch(o->"Deployment".equals(o.getKind()) && d.getMetadata().getUid().equals(o.getUid()));
    }
    static View read(KubernetesClient client,Deployment deployment) {
        var values=find(client,deployment);
        if(values.isEmpty())return new View(false,true,null,null,null,null,null,null,null,List.of(),List.of());
        var h=values.getFirst();var status=h.getStatus();var metrics=new ArrayList<Metric>();
        boolean supported=true;
        for(var m:h.getSpec().getMetrics()) {
            var r=m.getResource();
            if(!"Resource".equals(m.getType()) || r==null || !Set.of("cpu","memory").contains(r.getName()) || !"Utilization".equals(r.getTarget().getType())) {supported=false;continue;}
            Integer current=status==null?null:Optional.ofNullable(status.getCurrentMetrics()).orElse(List.of()).stream()
                    .filter(s->s.getResource()!=null && r.getName().equals(s.getResource().getName())).map(s->s.getResource().getCurrent())
                    .filter(Objects::nonNull).map(MetricValueStatus::getAverageUtilization).filter(Objects::nonNull).findFirst().orElse(null);
            metrics.add(new Metric(r.getName(),r.getTarget().getAverageUtilization(),current));
        }
        var conditions=new ArrayList<String>();
        if(values.size()>1)conditions.add("多个 HPA 指向此部署，请在集群中处理重复配置");
        if(status!=null)Optional.ofNullable(status.getConditions()).orElse(List.of()).forEach(c->conditions.add(c.getType()+": "+c.getStatus()+" · "+c.getReason()+" · "+Objects.toString(c.getMessage(),"")));
        return new View(true,values.size()==1 && owned(h,deployment) && supported,h.getMetadata().getName(),h.getMetadata().getResourceVersion(),
                h.getSpec().getMinReplicas(),h.getSpec().getMaxReplicas(),status==null?null:status.getCurrentReplicas(),status==null?null:status.getDesiredReplicas(),
                status==null?null:status.getLastScaleTime(),metrics,conditions);
    }
    static void validateRequests(Deployment deployment,List<HorizontalPodAutoscaler> hpas) {
        for(var h:hpas)for(var m:h.getSpec().getMetrics()) {
            var r=m.getResource();if(r==null || !"Utilization".equals(r.getTarget().getType()))continue;
            for(var c:deployment.getSpec().getTemplate().getSpec().getContainers()) {
                var resources=c.getResources();var requests=resources==null?null:resources.getRequests();
                var value=requests==null?null:requests.get(r.getName());
                // Kubernetes defaults a missing request to the explicit limit on admission.
                if(value==null && resources!=null && resources.getLimits()!=null)value=resources.getLimits().get(r.getName());
                if(value==null || Quantity.getAmountInBytes(value).signum()<=0)
                    throw ApplicationException.invalid("HPA requires a positive "+r.getName()+" request for container "+c.getName());
            }
        }
    }
    private static MetricSpec metric(String resource,int target) {
        return new MetricSpecBuilder().withType("Resource").withNewResource().withName(resource)
                .withNewTarget().withType("Utilization").withAverageUtilization(target).endTarget().endResource().build();
    }
    static View put(KubernetesClient client,Deployment deployment,Request request) {
        if(request==null || request.minReplicas()==null || request.maxReplicas()==null || request.minReplicas()<1
                || request.maxReplicas()<request.minReplicas() || request.maxReplicas()>100
                || (request.cpuUtilization()==null && request.memoryUtilization()==null)
                || (request.cpuUtilization()!=null && request.cpuUtilization()<1) || (request.memoryUtilization()!=null && request.memoryUtilization()<1))
            throw ApplicationException.invalid("HPA requires replicas 1..100 and at least one positive target utilization");
        if(deployment.getSpec().getReplicas()==0)throw ApplicationException.invalid("Start at least one replica before enabling HPA");
        var values=find(client,deployment);var current=values.isEmpty()?null:values.getFirst();
        if(current!=null && (values.size()!=1 || !read(client,deployment).editable()))throw ApplicationException.conflict("HPA is not editable by this deployment");
        if(!Objects.equals(current==null?null:current.getMetadata().getResourceVersion(),request.resourceVersion()))throw ApplicationException.conflict("HPA changed; refresh before saving");
        var h=current==null?new HorizontalPodAutoscalerBuilder().withNewMetadata().withName(deployment.getMetadata().getName())
                .withNamespace(deployment.getMetadata().getNamespace()).withLabels(deployment.getMetadata().getLabels())
                .addNewOwnerReference().withApiVersion("apps/v1").withKind("Deployment").withName(deployment.getMetadata().getName())
                .withUid(deployment.getMetadata().getUid()).withController(true).endOwnerReference().endMetadata()
                .withNewSpec().withNewScaleTargetRef().withApiVersion("apps/v1").withKind("Deployment").withName(deployment.getMetadata().getName()).endScaleTargetRef().endSpec().build()
                :new HorizontalPodAutoscalerBuilder(current).build();
        var metrics=new ArrayList<MetricSpec>();if(request.cpuUtilization()!=null)metrics.add(metric("cpu",request.cpuUtilization()));
        if(request.memoryUtilization()!=null)metrics.add(metric("memory",request.memoryUtilization()));
        h.getSpec().setMinReplicas(request.minReplicas());h.getSpec().setMaxReplicas(request.maxReplicas());h.getSpec().setMetrics(metrics);
        validateRequests(deployment,List.of(h));
        var resource=client.autoscaling().v2().horizontalPodAutoscalers().inNamespace(deployment.getMetadata().getNamespace()).resource(h);
        if(current==null)resource.create();else resource.lockResourceVersion(request.resourceVersion()).replace();
        return read(client,deployment);
    }
    static void delete(KubernetesClient client,Deployment deployment,String version) {
        var values=find(client,deployment);if(values.isEmpty())throw ApplicationException.missing("HPA not found");
        var h=values.getFirst();
        if(values.size()!=1 || !owned(h,deployment))throw ApplicationException.conflict("HPA is not owned by this deployment");
        if(!Objects.equals(h.getMetadata().getResourceVersion(),version))throw ApplicationException.conflict("HPA changed; refresh before deleting");
        client.autoscaling().v2().horizontalPodAutoscalers().inNamespace(deployment.getMetadata().getNamespace()).resource(h).lockResourceVersion(version).delete();
    }
}
