package com.project.platform.deployment.service;

import com.project.platform.deployment.application.ApplicationException;
import io.fabric8.kubernetes.api.model.*;
import io.fabric8.kubernetes.api.model.apps.*;
import io.fabric8.kubernetes.client.KubernetesClient;
import io.fabric8.kubernetes.client.dsl.base.ResourceDefinitionContext;
import io.fabric8.kubernetes.client.dsl.base.PatchContext;
import io.fabric8.kubernetes.client.dsl.base.PatchType;
import java.util.*;

/** Codec for the shared editor model. A warm projection is never submitted to the Deployment API. */
public final class DeploymentWorkloads {
    public static final String GROUP="elastic.cea.io/v1alpha1", EXT="extensions.agents.x-k8s.io/v1beta1";
    public static final String ONLINE="sandbox.users.io/online", APP="elastic.cea.io/app", MODE="cea-system/mode";
    public record Scope(String namespace,String clusterId,String kubeNamespace) {}
    public record Budget(boolean available,int count,int memoryMiB,String resourceVersion) {}
    private final Set<Scope> scopes;
    public DeploymentWorkloads(Collection<Scope> scopes) { this.scopes=Set.copyOf(scopes); }
    public Set<Scope> scopes() { return scopes; }
    public boolean enabled(String workspace,String cluster,String ns) { return scopes.contains(new Scope(workspace,cluster,ns)); }
    public static ResourceDefinitionContext definition(String api,String kind,String plural) {
        var parts=api.split("/");return new ResourceDefinitionContext.Builder().withGroup(parts[0]).withVersion(parts[1])
                .withKind(kind).withPlural(plural).withNamespaced(true).build();
    }
    public static final ResourceDefinitionContext WARM=definition(GROUP,"WarmService","warmservices"),
            TEMPLATE=definition(EXT,"SandboxTemplate","sandboxtemplates"),POOL=definition(EXT,"SandboxWarmPool","sandboxwarmpools");
    public static boolean warm(Deployment d) { return "warm".equals(Optional.ofNullable(d.getMetadata().getAnnotations()).orElse(Map.of()).get(MODE)); }
    public static String kind(Deployment d) { return warm(d)?"WarmService":"Deployment"; }
    public static String api(Deployment d) { return warm(d)?GROUP:"apps/v1"; }
    @SuppressWarnings("unchecked") public static Map<String,Object> map(Object value) { return value instanceof Map<?,?> m?(Map<String,Object>)m:Map.of(); }
    public static int number(Object value) { return value instanceof Number n?n.intValue():0; }
    public Deployment get(KubernetesClient k,String workspace,String cluster,String ns,String name) {
        var d=k.apps().deployments().inNamespace(ns).withName(name).get();
        if(d!=null || !enabled(workspace,cluster,ns))return d;
        var w=k.genericKubernetesResources(WARM).inNamespace(ns).withName(name).get();
        return w==null?null:project(k,w);
    }
    public List<Deployment> list(KubernetesClient k,String workspace,String cluster,String ns) {
        var result=new ArrayList<>(k.apps().deployments().inNamespace(ns).withLabel("cea-system/owner","cea-system")
                .withLabel("cea-system/namespace",workspace).list().getItems());
        if(enabled(workspace,cluster,ns))for(var w:k.genericKubernetesResources(WARM).inNamespace(ns).withLabel("cea-system/owner","cea-system")
                .withLabel("cea-system/namespace",workspace).list().getItems())result.add(project(k,w));
        return result;
    }
    private Deployment project(KubernetesClient k,GenericKubernetesResource w) {
        var spec=map(w.getAdditionalProperties().get("spec"));var status=map(w.getAdditionalProperties().get("status"));
        var pool=k.genericKubernetesResources(POOL).inNamespace(w.getMetadata().getNamespace()).withName((String)spec.get("poolName")).get();
        if(pool==null)throw ApplicationException.conflict("预热池配置未完成");
        String templateName=(String)map(map(pool.getAdditionalProperties().get("spec")).get("sandboxTemplateRef")).get("name");
        var t=k.genericKubernetesResources(TEMPLATE).inNamespace(w.getMetadata().getNamespace()).withName(templateName).get();
        if(t==null)throw ApplicationException.conflict("预热模板不存在");
        var template=k.getKubernetesSerialization().convertValue(map(t.getAdditionalProperties().get("spec")).get("podTemplate"),PodTemplateSpec.class);
        var labels=new HashMap<>(template.getMetadata().getLabels());labels.put(ONLINE,"true");
        var d=new DeploymentBuilder().withMetadata(new ObjectMetaBuilder(w.getMetadata()).build()).withNewSpec()
                .withReplicas(number(spec.get("replicas"))).withNewSelector().withMatchLabels(labels).endSelector().withTemplate(template).endSpec()
                .withNewStatus().withReplicas(number(status.get("replicas"))).withReadyReplicas(number(status.get("readyReplicas")))
                .withAvailableReplicas(number(status.get("readyReplicas"))).withUpdatedReplicas(number(status.get("replicas")))
                .withObservedGeneration(((Number)status.getOrDefault("observedGeneration",0L)).longValue()).endStatus().build();
        d.getSpec().getTemplate().getMetadata().setLabels(labels);
        d.getMetadata().getAnnotations().put(MODE,"warm");return d;
    }
    public Deployment save(KubernetesClient k,Deployment desired,Deployment existing,boolean warm) {
        String ns=desired.getMetadata().getNamespace();
        if(!warm)return existing==null?k.apps().deployments().inNamespace(ns).resource(desired).create():
                k.apps().deployments().inNamespace(ns).resource(desired).lockResourceVersion(existing.getMetadata().getResourceVersion()).replace();
        if(desired.getSpec().getReplicas()>20)throw ApplicationException.invalid("预热部署副本上限为20");
        String name=desired.getMetadata().getName();
        var old=existing==null?null:k.genericKubernetesResources(WARM).inNamespace(ns).withName(name).get();
        String poolName=name.substring(0,Math.min(48,name.length()))+"-"+UUID.randomUUID().toString().substring(0,8);
        var template=new PodTemplateSpecBuilder(desired.getSpec().getTemplate()).build();
        template.getMetadata().getLabels().remove(ONLINE);template.getMetadata().getLabels().put(APP,name);
        template.getMetadata().getLabels().put("elastic.cea.io/pool",poolName);
        var meta=new ObjectMetaBuilder().withName(poolName).withNamespace(ns).withLabels(desired.getMetadata().getLabels()).build();
        var t=object(EXT,"SandboxTemplate",meta,Map.of("podTemplate",k.getKubernetesSerialization().convertValue(template,Map.class),"service",false,"networkPolicyManagement","Unmanaged"));
        var p=object(EXT,"SandboxWarmPool",meta,Map.of("replicas",0,"sandboxTemplateRef",Map.of("name",poolName),"updateStrategy",Map.of("type","Recreate")));
        // New pool references also cause the adapter to replace old business claims on updates.
        var annotations=new HashMap<>(desired.getMetadata().getAnnotations());annotations.put(MODE,"warm");
        var wm=new ObjectMetaBuilder(desired.getMetadata()).withAnnotations(annotations).build();
        var w=object(GROUP,"WarmService",wm,Map.of("replicas",desired.getSpec().getReplicas(),"poolName",poolName));
        k.genericKubernetesResources(TEMPLATE).inNamespace(ns).resource(t).create();
        try {
            k.genericKubernetesResources(POOL).inNamespace(ns).resource(p).create();
            w=old==null?k.genericKubernetesResources(WARM).inNamespace(ns).resource(w).create():
                    k.genericKubernetesResources(WARM).inNamespace(ns).resource(w).lockResourceVersion(existing.getMetadata().getResourceVersion()).replace();
        } catch(RuntimeException ex) {
            // These uniquely named, unclaimed resources belong to this failed request only.
            k.genericKubernetesResources(POOL).inNamespace(ns).withName(poolName).delete();
            k.genericKubernetesResources(TEMPLATE).inNamespace(ns).withName(poolName).delete();throw ex;
        }
        var owner=new OwnerReferenceBuilder().withApiVersion(GROUP).withKind("WarmService").withName(name).withUid(w.getMetadata().getUid()).withController(true).build();
        own(k,TEMPLATE,ns,poolName,owner);own(k,POOL,ns,poolName,owner);
        if(old!=null) {
            String previous=(String)map(old.getAdditionalProperties().get("spec")).get("poolName");
            k.genericKubernetesResources(POOL).inNamespace(ns).withName(previous).delete();
            k.genericKubernetesResources(TEMPLATE).inNamespace(ns).withName(previous).delete();
        }
        return project(k,w);
    }
    private static void own(KubernetesClient k,ResourceDefinitionContext type,String ns,String name,OwnerReference owner) {
        // The Sandbox controller may add template labels or pool status concurrently.
        // Patch only our ownership field instead of replacing its freshly updated object.
        String patch=k.getKubernetesSerialization().asJson(Map.of("metadata",Map.of("ownerReferences",List.of(owner))));
        k.genericKubernetesResources(type).inNamespace(ns).withName(name).patch(PatchContext.of(PatchType.JSON_MERGE),patch);
    }
    public Deployment scale(KubernetesClient k,Deployment d,int replicas) {
        if(!warm(d))return k.apps().deployments().inNamespace(d.getMetadata().getNamespace()).resource(new DeploymentBuilder(d).editSpec().withReplicas(replicas).endSpec().build())
                .lockResourceVersion(d.getMetadata().getResourceVersion()).replace();
        if(replicas>20)throw ApplicationException.invalid("预热部署副本上限为20");
        var w=k.genericKubernetesResources(WARM).inNamespace(d.getMetadata().getNamespace()).withName(d.getMetadata().getName()).get();
        map(w.getAdditionalProperties().get("spec")).put("replicas",replicas);
        return project(k,k.genericKubernetesResources(WARM).inNamespace(d.getMetadata().getNamespace()).resource(w).lockResourceVersion(d.getMetadata().getResourceVersion()).replace());
    }
    public void delete(KubernetesClient k,Deployment d) {
        if(!warm(d))k.apps().deployments().inNamespace(d.getMetadata().getNamespace()).resource(d).lockResourceVersion(d.getMetadata().getResourceVersion()).delete();
        else k.genericKubernetesResources(WARM).inNamespace(d.getMetadata().getNamespace()).withName(d.getMetadata().getName()).lockResourceVersion(d.getMetadata().getResourceVersion()).delete();
    }
    public static GenericKubernetesResource object(String api,String kind,ObjectMeta meta,Map<String,Object> spec) {
        var value=new GenericKubernetesResource();value.setApiVersion(api);value.setKind(kind);value.setMetadata(new ObjectMetaBuilder(meta).build());
        value.setAdditionalProperty("spec",new HashMap<>(spec));return value;
    }
    public Budget budget(KubernetesClient k,String workspace,String cluster,String ns) {
        if(!enabled(workspace,cluster,ns))return new Budget(false,0,0,null);
        var cm=k.configMaps().inNamespace(ns).withName("cea-warm-settings").get();
        if(cm==null)return new Budget(false,0,0,null);
        return new Budget(true,Integer.parseInt(cm.getData().get("count")),Integer.parseInt(cm.getData().get("memoryMiB")),cm.getMetadata().getResourceVersion());
    }
    public Budget budget(KubernetesClient k,String workspace,String cluster,String ns,Budget value) {
        if(!enabled(workspace,cluster,ns))throw ApplicationException.invalid("此命名空间未启用预热池");
        if(value.count()<0 || value.count()>20 || value.memoryMiB()<0)throw ApplicationException.invalid("预热预算无效");
        var cm=k.configMaps().inNamespace(ns).withName("cea-warm-settings").get();
        if(cm==null || !Objects.equals(cm.getMetadata().getResourceVersion(),value.resourceVersion()))throw ApplicationException.conflict("预热预算已变化，请刷新");
        cm.setData(Map.of("count",Integer.toString(value.count()),"memoryMiB",Integer.toString(value.memoryMiB())));
        k.configMaps().inNamespace(ns).resource(cm).lockResourceVersion(value.resourceVersion()).replace();return budget(k,workspace,cluster,ns);
    }
}
