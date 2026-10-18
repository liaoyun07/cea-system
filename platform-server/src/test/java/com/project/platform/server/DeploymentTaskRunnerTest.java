package com.project.platform.server;

import com.project.platform.dataflow.execution.DeploymentTaskRunner;
import com.project.platform.deployment.application.ApplicationException;
import com.project.platform.deployment.service.DeploymentService;
import com.project.platform.foundation.identity.AccessPolicy.*;
import com.project.platform.resource.kubernetes.*;
import com.project.platform.runtime.definition.*;
import com.project.platform.runtime.worker.*;
import org.junit.jupiter.api.Test;
import java.util.*;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class DeploymentTaskRunnerTest {
    private final DeploymentService deployments=mock(DeploymentService.class);
    private final KubernetesManagementService management=mock(KubernetesManagementService.class);
    private final KubernetesConnections connections=mock(KubernetesConnections.class);
    private final TaskContext context=mock(TaskContext.class);
    private final Actor actor=new Actor("developer",Set.of("lab"),Set.of(Action.READ,Action.WRITE,Action.EXECUTE));
    private final AtomicReference<String> prepared=new AtomicReference<>();
    private final DeploymentTaskRunner runner=new DeploymentTaskRunner(deployments,management,connections,new BindingResolver(),job->actor);
    private final DeploymentService.DeploymentRecord operation=new DeploymentService.DeploymentRecord("op1","resident","v1","CREATE",1,"OBSERVING",null,null,null,null);
    private final DeploymentService.View view=new DeploymentService.View("edge","cloud","cea-lab","resident","v1","image","v2",1,1,true,List.of(),operation,false,null);
    private void setup() throws Exception {
        var flow=new FlowParser(new FlowValidator(new TemplateRenderer())).parse("""
            schemaVersion: 1
            namespace: lab
            id: resident
            inputs: {url: {type: STRING}}
            tasks:
              - id: deploy
                type: platform.Deployment
                timeout: PT1M
                container:
                  applicationId: resident
                  version: v1
                  candidateClusters: [cloud]
                  parameters: {CLOUD_URL: {source: INPUT, name: url}}
                  resources: {limits: {cpu: '2', memory: 1Gi}}
                deployment:
                  name: edge
                  kubeNamespace: cea-lab
                  readiness: {path: /health, port: 8080}
                  service: {port: 8080, targetPort: 8080, nodePort: 31101, endpoint: 'http://edge:31101'}
            """);
        when(context.job()).thenReturn(new WorkerJob("exec","run",1,flow.tasks().getFirst(),Map.of("execution",Map.of("namespace","lab"),"inputs",Map.of("url","http://cloud:31101"))));
        when(context.prepared()).thenAnswer(inv->prepared.get());
        doAnswer(inv->{prepared.set(inv.getArgument(0));return null;}).when(context).prepare(anyString());
        when(deployments.get(actor,"lab","cloud","cea-lab","edge")).thenReturn(view);
        when(deployments.put(eq(actor),eq("lab"),eq("cloud"),eq("cea-lab"),eq("edge"),any())).thenReturn(view);
        when(deployments.ready(actor,"lab","cloud","cea-lab","edge")).thenReturn(true);
        when(deployments.runtime(actor,"lab","cloud","cea-lab","edge")).thenReturn(new DeploymentService.RuntimeView("cea-lab",Map.of(),Map.of("cea-system/deployment","edge"),List.of()));
    }
    @Test void resolvesParametersAndReusesDeploymentAndServiceForUpdate() throws Exception {
        setup();var result=runner.run(context);
        assertTrue(result.success());assertEquals("http://edge:31101",result.outputs().get("endpoint"));
        verify(deployments).put(eq(actor),eq("lab"),eq("cloud"),eq("cea-lab"),eq("edge"),argThat(r->
                r.resourceVersion().equals("v2") && r.parameters().get("CLOUD_URL").equals("http://cloud:31101")
                && r.resources().cpuLimit().equals("2") && r.replicas()==1));
        verify(management).putService(eq(actor),eq("lab"),eq("cloud"),eq("cea-lab"),argThat(s->s.name().equals("edge") && s.ports().getFirst().nodePort()==31101));
        // Lease takeover waits for the same submitted operation; no second Deployment update.
        assertTrue(runner.run(context).success());verify(deployments,times(1)).put(any(),anyString(),anyString(),anyString(),anyString(),any());
    }
    @Test void createsWhenAbsentAndWaitsForCurrentRollout() throws Exception {
        setup();when(deployments.get(actor,"lab","cloud","cea-lab","edge")).thenThrow(ApplicationException.missing("missing")).thenReturn(view);
        when(deployments.ready(actor,"lab","cloud","cea-lab","edge")).thenReturn(false,true);
        assertTrue(runner.run(context).success());
        verify(deployments).put(any(),anyString(),anyString(),anyString(),anyString(),argThat(r->r.resourceVersion()==null));
        verify(deployments,times(2)).ready(any(),anyString(),anyString(),anyString(),anyString());
    }
    @Test void cancelledOrTimedOutStepKeepsExistingService() throws Exception {
        setup();prepared.set("op1");when(context.cancellation()).thenReturn("attempt timed out");
        assertFalse(runner.run(context).success());verifyNoInteractions(deployments,management);
    }
    @Test void cancellationAfterApplyStopsWaitingWithoutDeletingWorkloads() throws Exception {
        setup();when(context.cancellation()).thenReturn(null,null,"execution cancelled");
        var result=runner.run(context);assertFalse(result.success());assertEquals("execution cancelled",result.error());
        verify(deployments).get(actor,"lab","cloud","cea-lab","edge");
        verify(deployments).put(any(),anyString(),anyString(),anyString(),anyString(),any());
        verify(deployments).runtime(actor,"lab","cloud","cea-lab","edge");
        verify(management).putService(any(),anyString(),anyString(),anyString(),any());
        verifyNoMoreInteractions(deployments,management);assertEquals("op1",prepared.get());
    }
    @Test void rejectedConfigurationFailsInsteadOfWaitingForever() throws Exception {
        setup();when(deployments.put(any(),anyString(),anyString(),anyString(),anyString(),any())).thenThrow(ApplicationException.invalid("invalid application parameter"));
        var result=runner.run(context);assertFalse(result.success());assertEquals("invalid application parameter",result.error());
        verifyNoInteractions(management);assertNull(prepared.get());
    }
    @Test void servicePermissionFailureRetainsTheExistingPublicErrorMessage() throws Exception {
        setup();when(management.putService(any(),anyString(),anyString(),anyString(),any()))
                .thenThrow(new KubernetesResourceService.Unavailable("Kubernetes management permission denied; check configured RBAC"));
        var result=runner.run(context);assertFalse(result.success());
        assertEquals("Kubernetes management permission denied; check configured RBAC",result.error());
        assertEquals("op1",prepared.get());
    }
}
