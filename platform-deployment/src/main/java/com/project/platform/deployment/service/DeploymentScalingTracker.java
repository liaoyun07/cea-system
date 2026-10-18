package com.project.platform.deployment.service;

import com.project.platform.resource.kubernetes.KubernetesConnections;
import io.fabric8.kubernetes.api.model.*;
import io.fabric8.kubernetes.api.model.apps.Deployment;
import io.fabric8.kubernetes.client.KubernetesClient;
import java.time.*;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import com.project.platform.deployment.service.DeploymentWorkloads.Scope;

/** Observes replica changes, Pod identity and service membership; polls 500 ms after each scan. */
public final class DeploymentScalingTracker implements AutoCloseable {
    public record Identity(String uid,List<String> containers) {}
    public record Snapshot(Instant at,int desired,int ready,int standby,Map<String,Identity> active,Map<String,Identity> reserve,Object template) {}
    private record Pending(String id,Snapshot before,Instant start,int target,boolean warm) {}
    private final JdbcScalingRepository repository;
    private final KubernetesConnections connections;
    private final DeploymentWorkloads workloads;
    private final Clock clock;
    private final Map<String,Snapshot> previous=new HashMap<>();
    private final Map<String,Pending> pending=new HashMap<>();
    private final Map<String,Instant> sampled=new HashMap<>();
    private final Map<Scope,KubernetesClient> clients=new HashMap<>();
    private final tools.jackson.databind.json.JsonMapper json=new tools.jackson.databind.json.JsonMapper();
    private ScheduledExecutorService timer;
    public DeploymentScalingTracker(JdbcScalingRepository repository,KubernetesConnections connections,DeploymentWorkloads workloads,Clock clock) {
        this.repository=repository;this.connections=connections;this.workloads=workloads;this.clock=clock;
    }
    public synchronized void start() {
        if(timer!=null)return;repository.interrupted();
        timer=Executors.newSingleThreadScheduledExecutor(Thread.ofPlatform().daemon().name("deployment-scaling").factory());
        timer.scheduleWithFixedDelay(()->{try { tick(); }catch(RuntimeException ex){System.getLogger(getClass().getName()).log(System.Logger.Level.WARNING,"Scaling observation failed",ex);}},0,500,TimeUnit.MILLISECONDS);
    }
    public void tick() {
        for(var scope:workloads.scopes()) {
            try {
                var k=clients.computeIfAbsent(scope,s->connections.open(s.namespace(),s.clusterId()));
                var values=workloads.list(k,scope.namespace(),scope.clusterId(),scope.kubeNamespace());
                var pods=k.pods().inNamespace(scope.kubeNamespace()).withLabel("cea-system/owner","cea-system").withLabel("cea-system/namespace",scope.namespace()).list().getItems();
                var services=k.services().inNamespace(scope.kubeNamespace()).list().getItems();
                var endpoints=k.endpoints().inNamespace(scope.kubeNamespace()).list().getItems();
                var sets=k.apps().replicaSets().inNamespace(scope.kubeNamespace()).withLabel("cea-system/owner","cea-system").list().getItems();
                var seen=new HashSet<String>();
                for(var d:values) {
                    String uid=d.getMetadata().getUid();seen.add(uid);boolean warm=DeploymentWorkloads.warm(d);
                    var selector=d.getSpec().getSelector().getMatchLabels();
                    var children=new HashSet<String>();sets.stream().filter(r->owned(r.getMetadata(),uid)).forEach(r->children.add(r.getMetadata().getUid()));
                    String pool=selector.get("elastic.cea.io/pool");
                    var members=pods.stream().filter(p->warm?Objects.equals(pool,p.getMetadata().getLabels().get("elastic.cea.io/pool")):
                            children.stream().anyMatch(owner->owned(p.getMetadata(),owner))).toList();
                    var selectedServices=services.stream().filter(s->s.getSpec().getSelector()!=null && !s.getSpec().getSelector().isEmpty()
                            && s.getSpec().getSelector().entrySet().stream().allMatch(e->Objects.equals(selector.get(e.getKey()),e.getValue()))).map(s->s.getMetadata().getName()).toList();
                    Set<String> connected=null;
                    for(String service:selectedServices) {
                        var ids=new HashSet<String>();
                        endpoints.stream().filter(e->service.equals(e.getMetadata().getName())).forEach(e->Optional.ofNullable(e.getSubsets()).orElse(List.of())
                                .forEach(s->Optional.ofNullable(s.getAddresses()).orElse(List.of()).forEach(a->{if(a.getTargetRef()!=null)ids.add(a.getTargetRef().getUid());})));
                        if(connected==null)connected=ids;else connected.retainAll(ids);
                    }
                    var snapshot=snapshot(d,members,connected,clock.instant());
                    observe(scope,d.getMetadata().getName(),uid,warm,snapshot);
                }
                String prefix=scope.toString()+"/";
                for(String key:new ArrayList<>(previous.keySet()))if(key.startsWith(prefix) && !seen.contains(key.substring(prefix.length()))) {
                    finish(key,clock.instant(),"REMOVED",null);previous.remove(key);sampled.remove(key);
                }
            } catch(RuntimeException ex) {
                String prefix=scope.toString()+"/";
                for(String key:new ArrayList<>(pending.keySet()))if(key.startsWith(prefix))finish(key,clock.instant(),"INTERRUPTED",null);
                previous.keySet().removeIf(key->key.startsWith(prefix));
                System.getLogger(getClass().getName()).log(System.Logger.Level.WARNING,"Cannot observe scaling in "+scope,ex);
            }
        }
    }
    public void observe(Scope scope,String name,String uid,boolean warm,Snapshot current) {
        String key=scope.toString()+"/"+uid;var before=previous.get(key);
        if(before!=null && (Duration.between(before.at(),current.at()).toSeconds()>5 || !Objects.equals(before.template(),current.template()))) {
            finish(key,current.at(),Objects.equals(before.template(),current.template())?"INTERRUPTED":"SUPERSEDED",current);before=null;
        }
        if(before!=null && before.desired()!=current.desired()) {
            finish(key,current.at(),"SUPERSEDED",current);
            String id=repository.begin(scope,name,uid,current.at(),before.desired(),current.desired(),json.writeValueAsString(before.active()),json.writeValueAsString(before.reserve()));
            pending.put(key,new Pending(id,before,current.at(),current.desired(),warm));
        }
        var event=pending.get(key);
        if(event!=null) {
            boolean up=event.target()>event.before().desired();
            long fresh=current.active().keySet().stream().filter(id->!event.before().active().containsKey(id)).count();
            boolean done=up?current.ready()>=event.target() && fresh>=event.target()-event.before().desired():current.active().size()<=event.target() && current.ready()==event.target();
            if(done)finish(key,current.at(),"SUCCEEDED",current);
            else if(Duration.between(event.start(),current.at()).toMinutes()>=10)finish(key,current.at(),"TIMEOUT",current);
        }
        if(before==null || before.desired()!=current.desired() || before.ready()!=current.ready() || before.standby()!=current.standby()
                || Duration.between(sampled.getOrDefault(key,Instant.EPOCH),current.at()).toSeconds()>=10) {
            repository.sample(scope,name,uid,new JdbcScalingRepository.Sample(current.at(),current.desired(),current.ready(),current.standby()));sampled.put(key,current.at());
        }
        previous.put(key,current);
    }
    private void finish(String key,Instant at,String state,Snapshot current) {
        var e=pending.remove(key);if(e==null)return;
        boolean ok="SUCCEEDED".equals(state);
        Integer hits=ok && e.warm() && e.target()>e.before().desired()?hits(e.before().reserve(),current.active()):null;
        repository.finish(e.id(),at,state,ok?Duration.between(e.start(),at).toMillis():null,hits,current==null?null:json.writeValueAsString(current.active()));
    }
    public static int hits(Map<String,Identity> reserve,Map<String,Identity> active) {
        return (int)active.entrySet().stream().filter(e->e.getValue().containers().stream().noneMatch(String::isBlank)
                && !e.getValue().containers().isEmpty() && e.getValue().equals(reserve.get(e.getKey()))).count();
    }
    public static Snapshot snapshot(Deployment d,List<Pod> pods,Set<String> connected,Instant at) {
        var active=new HashMap<String,Identity>();var reserve=new HashMap<String,Identity>();int ready=0,standby=0;
        for(var p:pods) {
            if(p.getMetadata().getDeletionTimestamp()!=null)continue;
            boolean isReady=p.getStatus()!=null && Optional.ofNullable(p.getStatus().getConditions()).orElse(List.of()).stream().anyMatch(c->"Ready".equals(c.getType()) && "True".equals(c.getStatus()));
            var id=new Identity(p.getMetadata().getUid(),p.getStatus()==null?List.of():Optional.ofNullable(p.getStatus().getContainerStatuses()).orElse(List.of()).stream()
                    .map(c->Objects.toString(c.getContainerID(),"")).sorted().toList());
            if(DeploymentWorkloads.warm(d) && !"true".equals(p.getMetadata().getLabels().get(DeploymentWorkloads.ONLINE))) {
                standby++;if(isReady)reserve.put(id.uid(),id);
            } else {
                // Keep all live business identities; readiness and endpoint membership are counted separately.
                active.put(id.uid(),id);if(isReady && (connected==null || connected.contains(id.uid())))ready++;
            }
        }
        return new Snapshot(at,d.getSpec().getReplicas(),ready,standby,Map.copyOf(active),Map.copyOf(reserve),d.getSpec().getTemplate());
    }
    private static boolean owned(ObjectMeta meta,String uid) {
        return Optional.ofNullable(meta.getOwnerReferences()).orElse(List.of()).stream().anyMatch(o->uid.equals(o.getUid()) && Boolean.TRUE.equals(o.getController()));
    }
    @Override public synchronized void close() { if(timer!=null)timer.shutdownNow();clients.values().forEach(KubernetesClient::close); }
}
