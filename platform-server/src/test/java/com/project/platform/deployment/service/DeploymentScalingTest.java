package com.project.platform.deployment.service;

import org.junit.jupiter.api.Test;
import io.fabric8.kubernetes.api.model.*;
import io.fabric8.kubernetes.api.model.apps.DeploymentBuilder;
import java.time.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class DeploymentScalingTest {
    private final JdbcScalingRepository repo=mock(JdbcScalingRepository.class);
    private final DeploymentScalingTracker tracker=new DeploymentScalingTracker(repo,null,new DeploymentWorkloads(List.of()),Clock.systemUTC());
    private final DeploymentWorkloads.Scope scope=new DeploymentWorkloads.Scope("lab","cloud","test");
    private final Instant start=Instant.parse("2026-10-18T00:00:00Z");
    private DeploymentScalingTracker.Identity id(String uid,String container) {return new DeploymentScalingTracker.Identity(uid,List.of(container));}
    private DeploymentScalingTracker.Snapshot snap(int seconds,int target,int ready,Map<String,DeploymentScalingTracker.Identity> active,Map<String,DeploymentScalingTracker.Identity> reserve) {
        return new DeploymentScalingTracker.Snapshot(start.plusSeconds(seconds),target,ready,reserve.size(),active,reserve,"template1");
    }
    @Test void waitsForEndpointMembershipAndCountsOnlyPreservedIdentity() {
        when(repo.begin(any(),any(),any(),any(),anyInt(),anyInt(),any(),any())).thenReturn("event");
        var a=Map.of("a",id("a","a1"));var reserve=Map.of("b",id("b","b1"));var active=Map.of("a",id("a","a1"),"b",id("b","b1"));
        tracker.observe(scope,"service","uid",true,snap(0,1,1,a,reserve));
        tracker.observe(scope,"service","uid",true,snap(1,2,1,active,Map.of()));
        verify(repo,never()).finish(any(),any(),any(),any(),any(),any());
        tracker.observe(scope,"service","uid",true,snap(2,2,2,active,Map.of()));
        verify(repo).finish(eq("event"),eq(start.plusSeconds(2)),eq("SUCCEEDED"),eq(1000L),eq(1),any());
        assertEquals(0,DeploymentScalingTracker.hits(reserve,Map.of("b",id("b","restarted"))));
    }
    @Test void laterTargetAndObservationGapDoNotBecomeSuccessfulTiming() {
        when(repo.begin(any(),any(),any(),any(),anyInt(),anyInt(),any(),any())).thenReturn("first","second");
        var a=Map.of("a",id("a","a1"));
        tracker.observe(scope,"service","uid",false,snap(0,1,1,a,Map.of()));
        tracker.observe(scope,"service","uid",false,snap(1,3,1,a,Map.of()));
        tracker.observe(scope,"service","uid",false,snap(2,2,1,a,Map.of()));
        verify(repo).finish(eq("first"),any(),eq("SUPERSEDED"),isNull(),isNull(),any());
        tracker.observe(scope,"service","uid",false,snap(20,2,2,a,Map.of()));
        verify(repo).finish(eq("second"),any(),eq("INTERRUPTED"),isNull(),isNull(),any());
    }
    @Test void standbyIsNotBusinessReadyAndEndpointsMustIncludePod() {
        var d=new DeploymentBuilder().withNewMetadata().addToAnnotations(DeploymentWorkloads.MODE,"warm").endMetadata()
                .withNewSpec().withReplicas(1).withNewTemplate().endTemplate().endSpec().build();
        var p=new PodBuilder().withNewMetadata().withUid("p").withLabels(new HashMap<>()).endMetadata().withNewStatus()
                .addNewCondition().withType("Ready").withStatus("True").endCondition().addNewContainerStatus().withContainerID("c").endContainerStatus().endStatus().build();
        assertEquals(1,DeploymentScalingTracker.snapshot(d,List.of(p),Set.of(),start).standby());
        p.getMetadata().getLabels().put(DeploymentWorkloads.ONLINE,"true");
        assertEquals(0,DeploymentScalingTracker.snapshot(d,List.of(p),Set.of(),start).ready());
        assertEquals(1,DeploymentScalingTracker.snapshot(d,List.of(p),Set.of("p"),start).ready());
    }
    @Test void warmPoolScopesDoNotEnableOtherClustersOrNamespaces() {
        var w=new DeploymentWorkloads(List.of(scope));
        assertTrue(w.enabled("lab","cloud","test"));assertFalse(w.enabled("lab","edge-a","test"));assertFalse(w.enabled("other","cloud","test"));
    }
}
