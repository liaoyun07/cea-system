package com.project.platform.server;

import com.project.platform.dataflow.definition.FlowRevision;
import com.project.platform.dataflow.execution.FlowExecutionService;
import com.project.platform.runtime.definition.*;
import com.project.platform.runtime.model.ExecutionRecord;
import com.project.platform.runtime.model.FlowDefinition;
import com.project.platform.resource.catalog.ResourceCatalog;
import com.project.platform.deployment.application.ApplicationVersion;
import com.project.platform.server.api.*;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.web.bind.annotation.*;
import static org.junit.jupiter.api.Assertions.*;

/** Guards the checked-in contract against route and record-field drift. Not a full OpenAPI validator. */
class ContractTest {
    private final JsonCodec json = new JsonCodec();
    private Map<String,Object> specification() throws Exception {
        return json.map(Files.readString(Path.of("..","docs","contracts","openapi.json")));
    }
    @Test void openApiRoutesMatchControllers() throws Exception {
        Set<String> actual = new TreeSet<>();
        for (Class<?> controller : List.of(HealthController.class,UserController.class,ImageBuildController.class,KubernetesManagementController.class,RegistryController.class,KubernetesResourceController.class,FlowController.class,ExecutionController.class,ResourceController.class,ApplicationController.class,ImageDistributionController.class,DeploymentController.class,EdgeController.class,EdgeAccessController.class,OffloadingController.class,NamespaceFileController.class,WebhookController.class)) {
            String base = controller.getAnnotation(RequestMapping.class).value()[0];
            for (var method : controller.getDeclaredMethods()) {
                var get = method.getAnnotation(GetMapping.class);
                var post = method.getAnnotation(PostMapping.class);
                var put = method.getAnnotation(PutMapping.class);
                var delete = method.getAnnotation(DeleteMapping.class);
                var patch = method.getAnnotation(PatchMapping.class);
                if (patch != null) actual.add("patch " + base + (patch.value().length == 0 ? "" : patch.value()[0]));
                if (delete != null) actual.add("delete " + base + (delete.value().length == 0 ? "" : delete.value()[0]));
                if (get != null) actual.add("get " + base + (get.value().length == 0 ? "" : get.value()[0]));
                if (post != null) actual.add("post " + base + (post.value().length == 0 ? "" : post.value()[0]));
                if (put != null) actual.add("put " + base + (put.value().length == 0 ? "" : put.value()[0]));
            }
        }
        Map<?,?> paths = (Map<?,?>) specification().get("paths");
        Set<String> documented = new TreeSet<>();
        paths.forEach((path, methods) -> ((Map<?,?>)methods).keySet().forEach(verb -> {
            if (!verb.equals("parameters")) documented.add(verb + " " + path);
        }));
        assertEquals(actual, documented);
    }
    @Test void documentedRecordFieldsMatchJavaAndRefsExist() throws Exception {
        var spec = specification();
        Map<?,?> schemas = (Map<?,?>)((Map<?,?>)spec.get("components")).get("schemas");
        Map<String,Class<?>> records = Map.ofEntries(
                Map.entry("IngressClass",com.project.platform.resource.kubernetes.KubernetesManagementService.IngressClassInfo.class),
                Map.entry("IngressRoute",com.project.platform.resource.kubernetes.KubernetesManagementService.IngressRoute.class),
                Map.entry("IngressSave",com.project.platform.resource.kubernetes.KubernetesManagementService.IngressRequest.class),
                Map.entry("ManagedIngress",com.project.platform.resource.kubernetes.KubernetesManagementService.IngressInfo.class),
                Map.entry("ExecutionMeasurement",com.project.platform.dataflow.execution.ExecutionMeasurementService.View.class),
                Map.entry("UserProfile",com.project.platform.server.security.IdentityDirectory.Profile.class),
                Map.entry("UserCreate",com.project.platform.server.security.IdentityDirectory.Create.class),
                Map.entry("UserUpdate",com.project.platform.server.security.IdentityDirectory.Update.class),
                Map.entry("PasswordChange",com.project.platform.server.security.IdentityDirectory.PasswordChange.class),
                Map.entry("PasswordReset",com.project.platform.server.security.IdentityDirectory.PasswordReset.class),
                Map.entry("ImageBuildResult",com.project.platform.deployment.upload.ImageBuildService.Result.class),
                Map.entry("ManagedNamespace",com.project.platform.resource.kubernetes.KubernetesManagementService.NamespaceInfo.class),
                Map.entry("NamespaceCreate",com.project.platform.resource.kubernetes.KubernetesManagementService.NamespaceRequest.class),
                Map.entry("ServicePortConfiguration",com.project.platform.resource.kubernetes.KubernetesManagementService.Port.class),
                Map.entry("ServiceCreate",com.project.platform.resource.kubernetes.KubernetesManagementService.ServiceRequest.class),
                Map.entry("ServicePod",com.project.platform.resource.kubernetes.KubernetesManagementService.PodInfo.class),
                Map.entry("ManagedService",com.project.platform.resource.kubernetes.KubernetesManagementService.ServiceInfo.class),
                Map.entry("RegistryInfo",com.project.platform.deployment.distribution.RegistryManagementService.RegistryInfo.class),
                Map.entry("RegistryRepositoryPage",com.project.platform.deployment.distribution.RegistryManagementService.RepositoryPage.class),
                Map.entry("RegistryImage",com.project.platform.deployment.distribution.RegistryManagementService.ImageInfo.class),
                Map.entry("RegistryPlatform",com.project.platform.deployment.distribution.RegistryManagementService.PlatformInfo.class),
                Map.entry("RegistryImageDetail",com.project.platform.deployment.distribution.RegistryManagementService.ImageDetail.class),
                Map.entry("ImageUploadRequest",com.project.platform.deployment.upload.ImageUploadService.Request.class),
                Map.entry("ImageDistribution",com.project.platform.deployment.distribution.ImageDistributionService.Distribution.class),
                Map.entry("DeploymentReadiness",com.project.platform.deployment.service.DeploymentService.Readiness.class),
                Map.entry("DeploymentScale",com.project.platform.deployment.service.DeploymentService.ScaleRequest.class),
                Map.entry("DeploymentConfiguration",com.project.platform.deployment.service.DeploymentService.Configuration.class),
                Map.entry("DeploymentRecord",com.project.platform.deployment.service.DeploymentService.DeploymentRecord.class),
                Map.entry("KubernetesUsage",com.project.platform.resource.kubernetes.KubernetesResourceService.Usage.class),
                Map.entry("KubernetesNodeUsage",com.project.platform.resource.kubernetes.KubernetesResourceService.NodeUsage.class),
                Map.entry("KubernetesClusterUsage",com.project.platform.resource.kubernetes.KubernetesResourceService.ClusterUsage.class),
                Map.entry("KubernetesContainerUsage",com.project.platform.resource.kubernetes.KubernetesResourceService.ContainerUsage.class),
                Map.entry("ExecutionOutputSource",com.project.platform.dataflow.execution.ExecutionOutputService.OutputSource.class),
                Map.entry("ExecutionOverview",com.project.platform.runtime.execution.ExecutionService.Overview.class),
                Map.entry("ExecutionDayCount",com.project.platform.runtime.execution.ExecutionService.DayCount.class),
                Map.entry("ExecutionRecent",com.project.platform.runtime.execution.ExecutionService.Recent.class),
                Map.entry("KubernetesNodePage",com.project.platform.resource.kubernetes.KubernetesResourceService.Page.class),
                Map.entry("KubernetesServicePage",com.project.platform.resource.kubernetes.KubernetesResourceService.Page.class),
                Map.entry("KubernetesNode",com.project.platform.resource.kubernetes.KubernetesResourceService.NodeView.class),
                Map.entry("KubernetesService",com.project.platform.resource.kubernetes.KubernetesResourceService.ServiceView.class),
                Map.entry("KubernetesNamespace",com.project.platform.resource.kubernetes.KubernetesResourceService.NamespaceView.class),
                Map.entry("NamespaceFileSave",NamespaceFileController.Save.class),
                Map.entry("NamespaceFile",com.project.platform.dataflow.definition.NamespaceFileService.File.class),
                Map.entry("NamespaceFileEntry",com.project.platform.dataflow.definition.NamespaceFileService.Entry.class),
                Map.entry("NamespaceFileRef",FlowDefinition.NamespaceFile.class),
                Map.entry("FlowCheck",FlowDefinition.Check.class),
                Map.entry("FlowSla",FlowDefinition.Sla.class),
                Map.entry("FlowSourceRequest",FlowController.SourceRequest.class),
                Map.entry("FlowPreviewRequest",FlowController.PreviewRequest.class),
                Map.entry("FlowImportRequest",FlowController.ImportRequest.class),
                Map.entry("FlowImportEntry",com.project.platform.dataflow.definition.FlowService.ImportEntry.class),
                Map.entry("FlowPreview",com.project.platform.dataflow.definition.FlowService.Preview.class),
                Map.entry("Offload",FlowDefinition.Offload.class),
                Map.entry("DqnModel",com.project.platform.offloading.DqnModel.class),
                Map.entry("OffloadingSample",com.project.platform.offloading.OffloadingService.Sample.class),
                Map.entry("OffloadingMeasurement",com.project.platform.offloading.OffloadingService.Measurement.class),
                Map.entry("OffloadingFeedback",com.project.platform.offloading.OffloadingService.Feedback.class),
                Map.entry("OffloadingTarget",com.project.platform.offloading.OffloadingService.Target.class),
                Map.entry("GatewayRegistration",com.project.platform.edge.EdgeAccess.GatewayRegistration.class),
                Map.entry("Gateway",com.project.platform.edge.EdgeAccess.Gateway.class),
                Map.entry("TerminalRegistration",com.project.platform.edge.EdgeAccess.TerminalRegistration.class),
                Map.entry("Terminal",com.project.platform.edge.EdgeAccess.Terminal.class),
                Map.entry("PolicyRequest",com.project.platform.edge.EdgeAccess.PolicyRequest.class),
                Map.entry("Policy",com.project.platform.edge.EdgeAccess.Policy.class),
                Map.entry("PolicyView",com.project.platform.edge.EdgeAccess.PolicyView.class),
                Map.entry("EdgeEvent",com.project.platform.edge.EdgeAccess.Event.class),
                Map.entry("SaveRequest",FlowController.SaveRequest.class),
                Map.entry("RollbackRequest",FlowController.RollbackRequest.class),
                Map.entry("ExecutionRequest",FlowExecutionService.Request.class),
                Map.entry("Accepted",ExecutionController.Accepted.class),
                Map.entry("Execution",ExecutionController.View.class),
                Map.entry("FlowRevision",FlowRevision.class),
                Map.entry("RevisionSummary",FlowRevision.Summary.class),
                Map.entry("TaskRun",ExecutionRecord.TaskRun.class),
                Map.entry("Attempt",ExecutionRecord.Attempt.class),
                Map.entry("LogEntry",ExecutionRecord.LogEntry.class),
                Map.entry("FlowDefinition",FlowDefinition.class),
                Map.entry("Task",FlowDefinition.Task.class),
                Map.entry("Container",FlowDefinition.Container.class),
                Map.entry("HttpTask",FlowDefinition.Http.class),
                Map.entry("SqlTask",FlowDefinition.Sql.class),
                Map.entry("Repeat",FlowDefinition.Repeat.class),
                Map.entry("Loop",FlowDefinition.Loop.class),
                Map.entry("Input",FlowDefinition.Input.class),
                Map.entry("Retry",FlowDefinition.Retry.class),
                Map.entry("Concurrency",FlowDefinition.Concurrency.class),
                Map.entry("Schedule",FlowDefinition.Schedule.class),
                Map.entry("ResourceCluster",ResourceCatalog.Cluster.class),
                Map.entry("ResourceLocation",ResourceCatalog.Location.class),
                Map.entry("DatasetVersion",ResourceCatalog.DatasetVersion.class),
                Map.entry("DatasetRequirement",ResourceCatalog.DatasetRequirement.class),
                Map.entry("PlacementRequest",ResourceCatalog.PlacementRequest.class),
                Map.entry("DatasetLocation",ResourceCatalog.DatasetLocation.class),
                Map.entry("PlacementOption",ResourceCatalog.PlacementOption.class),
                Map.entry("ApplicationVersion",ApplicationVersion.class),
                Map.entry("ApplicationParameter",ApplicationVersion.Parameter.class),
                Map.entry("DatasetRef",ApplicationVersion.DatasetRef.class),
                Map.entry("DatasetRule",ApplicationVersion.DatasetRule.class),
                Map.entry("PreparedImage",com.project.platform.deployment.distribution.ImageDistributionService.PreparedImage.class),
                Map.entry("DeploymentRequest",com.project.platform.deployment.service.DeploymentService.Request.class),
                Map.entry("DeploymentView",com.project.platform.deployment.service.DeploymentService.View.class));
        records.forEach((name,type) -> {
            Set<String> fields = new TreeSet<>();
            for (var component : type.getRecordComponents()) {
                var property=component.getAccessor().getAnnotation(com.fasterxml.jackson.annotation.JsonProperty.class);
                fields.add(property==null?component.getName():property.value());
            }
            assertEquals(fields, ((Map<?,?>)((Map<?,?>)schemas.get(name)).get("properties")).keySet(),name);
        });
        checkRefs(spec, schemas);
    }
    private void checkRefs(Object value,Map<?,?> schemas) {
        if (value instanceof Map<?,?> map) {
            if (map.containsKey("$ref")) {
                String ref = map.get("$ref").toString();
                assertTrue(ref.startsWith("#/components/schemas/"));
                assertTrue(schemas.containsKey(ref.substring("#/components/schemas/".length())),ref);
            }
            map.values().forEach(item -> checkRefs(item,schemas));
        } else if (value instanceof List<?> list) list.forEach(item -> checkRefs(item,schemas));
    }
    @Test void checkedInExampleUsesTheRealDefinitionParser() throws Exception {
        var parser = new FlowParser(new FlowValidator(new TemplateRenderer()));
        var terminal=parser.parse(Files.readString(Path.of("..","examples","s5-terminal-flow.yaml")));
        var offload=parser.parse(Files.readString(Path.of("..","examples","s5-offloading-flow.yaml")));
        assertEquals(FlowDefinition.OffloadStrategy.RULE,offload.tasks().getFirst().container().offload().strategy());
        assertEquals(FlowDefinition.ContainerExecution.TERMINAL,terminal.tasks().getFirst().container().execution());
        assertEquals(FlowDefinition.ContainerExecution.CLUSTER,terminal.tasks().getLast().container().execution());
        for(String algorithm:List.of("fedavg","fedprox")) {
            var federation=parser.parse(Files.readString(Path.of("..","examples","federated",algorithm+".yaml")));
            assertEquals(algorithm,federation.id());
            assertEquals("core.Repeat",federation.tasks().get(1).type());
            assertEquals("evaluate",federation.tasks().get(1).tasks().getLast().id());
            assertEquals("core.Loop",federation.tasks().get(1).tasks().getFirst().type());
            assertEquals(1,federation.tasks().get(1).tasks().getFirst().tasks().size());
            assertFalse(federation.inputs().containsKey("clients"));
            var values=assertInstanceOf(FlowDefinition.Literal.class,federation.tasks().get(1).tasks().getFirst().loop().values());
            assertEquals(3,((List<?>)values.value()).size());
        }
        var repeat=parser.parse(Files.readString(Path.of("..","examples","s5-repeat-flow.yaml")));
        assertEquals("core.Repeat",repeat.tasks().getFirst().type());
        assertEquals(2,new BindingResolver().prepare(repeat,Map.of()).inputs().get("rounds"));
        var flow = parser.parse(Files.readString(Path.of("..","examples","s1-log-flow.yaml")));
        assertEquals(2,flow.tasks().size());
        assertEquals(2,new BindingResolver().prepare(flow,Map.of("name","Ada")).inputs().get("count"));
        var lifecycle = parser.parse(Files.readString(Path.of("..","examples","s2-retry-cleanup.yaml")));
        assertEquals("core.Sleep",lifecycle.tasks().getFirst().type());
        assertEquals(2,lifecycle.tasks().get(1).retry().maxAttempts());
        assertEquals("cleanup",lifecycle.finallyTasks().getFirst().id());
        var control = parser.parse(Files.readString(Path.of("..","examples","s3-control-flow.yaml")));
        assertEquals("core.Dag",control.tasks().getFirst().type());
        assertEquals(2,control.concurrency().limit());
        assertTrue(control.schedule().disabled());
        assertEquals("Asia/Shanghai",control.schedule().timezone());
        var application=parser.parse(Files.readString(Path.of("..","examples","s4-application-flow.yaml")));
        assertEquals("platform.Application",application.tasks().getFirst().type());
        assertEquals(Set.of("greeting"),application.inputs().keySet());
    }
}
