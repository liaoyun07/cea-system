package com.project.platform.deployment.service;

import io.fabric8.kubernetes.api.model.apps.DeploymentBuilder;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class DeploymentReadinessTest {
    @Test void oldReadyPodsDoNotCompleteANewRollout() {
        var value=new DeploymentBuilder().withNewMetadata().withGeneration(2L).endMetadata().withNewSpec().withReplicas(1).endSpec()
                .withNewStatus().withObservedGeneration(1L).withReadyReplicas(1).withAvailableReplicas(1).withReplicas(1).withUpdatedReplicas(1).endStatus().build();
        assertFalse(DeploymentRolloutTracker.ready(value));
        value.getStatus().setObservedGeneration(2L);value.getStatus().setUpdatedReplicas(0);assertFalse(DeploymentRolloutTracker.ready(value));
        value.getStatus().setUpdatedReplicas(1);value.getStatus().setReplicas(2);assertFalse(DeploymentRolloutTracker.ready(value));
        value.getStatus().setReplicas(1);assertTrue(DeploymentRolloutTracker.ready(value));
    }
}
