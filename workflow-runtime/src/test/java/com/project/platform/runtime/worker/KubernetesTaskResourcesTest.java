package com.project.platform.runtime.worker;

import io.fabric8.kubernetes.api.model.*;
import io.fabric8.kubernetes.api.model.batch.v1.*;
import com.project.platform.runtime.model.FlowDefinition.ContainerResources;
import com.project.platform.runtime.model.FlowDefinition.ResourceLimits;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class KubernetesTaskResourcesTest {
    @Test void taskLimitsOnlyReachMainContainerAndDoNotSetRequests() {
        for(var limits:java.util.List.of(new ResourceLimits("500m","512Mi"),
                new ResourceLimits("0.5",null),new ResourceLimits(null,"1Gi"))) {
            var job=job();KubernetesJobRunner.configureTaskResources(job,new ContainerResources(limits));
            var pod=job.getSpec().getTemplate().getSpec();var resources=pod.getContainers().getFirst().getResources();
            assertTrue(resources.getRequests().isEmpty());
            assertEquals(limits.cpu()!=null,resources.getLimits().containsKey("cpu"));
            assertEquals(limits.memory()!=null,resources.getLimits().containsKey("memory"));
            assertNull(pod.getContainers().get(1).getResources());assertNull(pod.getInitContainers().getFirst().getResources());
        }
    }
    @Test void emptyTaskLimitsLeaveExistingDefaultsUntouched() {
        var job=job();var limits=java.util.Map.of("cpu",new Quantity("500m"),"memory",new Quantity("512Mi"));
        job.getSpec().getTemplate().getSpec().getContainers().getFirst()
                .setResources(new ResourceRequirementsBuilder().withLimits(limits).withRequests(limits).build());
        var before=new JobBuilder(job).build();
        KubernetesJobRunner.configureTaskResources(job,null);
        KubernetesJobRunner.configureTaskResources(job,new ContainerResources(new ResourceLimits("",null)));
        assertEquals(before,job);
    }
    private Job job() {
        return new JobBuilder().withNewSpec().withNewTemplate().withNewSpec()
                .addNewInitContainer().withName("files-in").endInitContainer()
                .addNewContainer().withName("task").endContainer()
                .addNewContainer().withName("files-out").endContainer()
                .endSpec().endTemplate().endSpec().build();
    }
}
