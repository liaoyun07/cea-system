package com.project.platform.runtime.worker;

import com.project.platform.runtime.definition.JsonCodec;
import io.fabric8.kubernetes.api.model.*;
import io.fabric8.kubernetes.api.model.batch.v1.*;
import org.junit.jupiter.api.Test;
import java.util.Map;
import static org.junit.jupiter.api.Assertions.*;

class KubernetesResourceReportTest {
    private final JsonCodec json=new JsonCodec();
    private String message() {return json.write(Map.of("transfers",java.util.List.of(),"resources",Map.of("status","COMPLETE","cpuCoreSeconds",1.2,
            "memoryByteSeconds",400,"durationSeconds",2,"peakMemoryBytes",300,"samples",21)));}
    @Test void parsesRealCounterUnitsAndPreservesMissingVersusZero() {
        var value=KubernetesResourceReport.parse("task",message());
        assertEquals("COMPLETE",value.status());assertEquals(1.2,value.cpuCoreSeconds());assertEquals(400d,value.memoryByteSeconds());
        assertEquals("MISSING",KubernetesResourceReport.parse("task",null).status());
        assertNull(KubernetesResourceReport.parse("task",null).cpuCoreSeconds());
        assertEquals("MISSING",KubernetesResourceReport.parse("task","{\"transfers\":[]}").status());
        assertEquals("INCOMPLETE",KubernetesResourceReport.parse("task","{\"resources\":{\"status\":\"INCOMPLETE\"}}").status());
    }
    @Test void invalidOrTruncatedReportsDoNotFailBusinessExecution() {
        for(String text:java.util.List.of("not json",message().substring(0,60),message().replace("1.2","-1.2"),message().replace("1.2","1e999")))
            assertEquals("INVALID",KubernetesResourceReport.parse("task",text).status());
    }
    @Test void includesInitAndBothOrdinaryContainersEvenIfAlgorithmFailed() {
        var job=new JobBuilder().withNewMetadata().withName("job").withUid("job-uid").withNamespace("lab").endMetadata().build();
        var pod=new PodBuilder().withNewMetadata().withUid("pod-uid").endMetadata().withNewStatus()
                .withInitContainerStatuses(status("files-in",0)).withContainerStatuses(status("task",7),status("files-out",0)).endStatus().build();
        var report=KubernetesResourceReport.read(job,pod);
        assertTrue(report.complete());assertEquals(3,report.containers().size());assertEquals("pod-uid",report.podUid());
        assertFalse(KubernetesResourceReport.read(job,null).complete());
    }
    @Test void workerResultRoundTripsResourceUsageAndReadsOldMessages() {
        var job=new JobBuilder().withNewMetadata().withName("job").withUid("uid").endMetadata().build();
        var result=WorkerJob.Result.failed("error").withResources(KubernetesResourceReport.read(job,null));
        assertEquals(result,json.read(json.write(result),WorkerJob.Result.class));
        assertNull(json.read("{\"success\":true,\"outputs\":{},\"error\":null}",WorkerJob.Result.class).resourceUsage());
    }
    private ContainerStatus status(String name,int exit) {
        return new ContainerStatusBuilder().withName(name).withNewState().withNewTerminated().withExitCode(exit).withMessage(message()).endTerminated().endState().build();
    }
}
