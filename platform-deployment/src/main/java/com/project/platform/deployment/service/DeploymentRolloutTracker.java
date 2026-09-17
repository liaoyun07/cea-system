package com.project.platform.deployment.service;

import com.project.platform.resource.kubernetes.KubernetesConnections;
import io.fabric8.kubernetes.api.model.apps.Deployment;
import java.time.*;
import java.util.Objects;
import java.util.concurrent.*;

/** Observes accepted changes only. Never applies, retries or schedules a workload. */
public final class DeploymentRolloutTracker implements AutoCloseable {
    private final JdbcDeploymentRecordRepository records;
    private final KubernetesConnections connections;
    private final Clock clock;
    private ScheduledExecutorService timer;
    public DeploymentRolloutTracker(JdbcDeploymentRecordRepository records,KubernetesConnections connections,Clock clock) {
        this.records=records;this.connections=connections;this.clock=clock;
    }
    public synchronized void start() {
        if(timer!=null)return;
        timer=Executors.newSingleThreadScheduledExecutor(Thread.ofPlatform().daemon().name("deployment-observer").factory());
        timer.scheduleWithFixedDelay(()->{
            try { tick(); }
            catch(RuntimeException ex) { System.getLogger(getClass().getName()).log(System.Logger.Level.WARNING,"Deployment observation unavailable; timing continuity will be checked on recovery"); }
        },0,1,TimeUnit.SECONDS);
    }
    public void tick() {
        for(var item:records.active()) {
            Instant now=clock.instant();
            if(now.isAfter(item.deadline())) { records.finish(item.id(),"UNKNOWN","Deployment was not confirmed before observation deadline",now,false);continue; }
            if(!"OBSERVING".equals(item.state()) || item.kubeNamespace()==null)continue;
            // A restart, stalled observer or failed query cannot silently yield a precise measurement.
            boolean continuous=!now.isBefore(item.lastObservedAt()) && Duration.between(item.lastObservedAt(),now).compareTo(Duration.ofSeconds(5))<=0;
            try(var client=connections.open(item.namespace(),item.clusterId())) {
                Deployment deployment=client.apps().deployments().inNamespace(item.kubeNamespace()).withName(item.name()).get();
                now=clock.instant();
                if(now.isAfter(item.deadline())) { records.finish(item.id(),"UNKNOWN","Observation completed after deadline",now,false);continue; }
                continuous=continuous && !now.isBefore(item.lastObservedAt()) && Duration.between(item.lastObservedAt(),now).compareTo(Duration.ofSeconds(5))<=0;
                if(deployment==null || !Objects.equals(deployment.getMetadata().getUid(),item.uid()) || deployment.getMetadata().getDeletionTimestamp()!=null) {
                    records.finish(item.id(),"SUPERSEDED","Deployment was removed or recreated",now,false);continue;
                }
                if(!Objects.equals(deployment.getMetadata().getGeneration(),item.generation())) {
                    records.finish(item.id(),"SUPERSEDED","A later configuration replaced this deployment change",now,false);continue;
                }
                var status=deployment.getStatus();
                boolean observed=status!=null && status.getObservedGeneration()!=null && status.getObservedGeneration()>=item.generation();
                if(observed && status.getConditions()!=null && status.getConditions().stream().anyMatch(c->"Progressing".equals(c.getType()) && "False".equals(c.getStatus()) && "ProgressDeadlineExceeded".equals(c.getReason()))) {
                    records.finish(item.id(),"FAILED","Kubernetes reported ProgressDeadlineExceeded",now,false);continue;
                }
                if(observed && count(status.getUpdatedReplicas())==item.replicas() && count(status.getAvailableReplicas())==item.replicas()
                        && count(status.getReadyReplicas())==item.replicas() && count(status.getReplicas())==item.replicas()) {
                    records.finish(item.id(),"SUCCEEDED",null,now,continuous);continue;
                }
                records.observed(item.id(),now,continuous);
            } catch(RuntimeException ex) {
                records.observed(item.id(),clock.instant(),false);
            }
        }
    }
    private static int count(Integer value) { return value==null?0:value; }
    @Override public synchronized void close() { if(timer!=null){timer.shutdownNow();timer=null;} }
}
