package com.project.platform.server;

import com.project.platform.dataflow.definition.FlowRevision;
import com.project.platform.dataflow.execution.FlowExecutionService;
import com.project.platform.runtime.definition.*;
import com.project.platform.runtime.model.ExecutionRecord;
import com.project.platform.runtime.model.FlowDefinition;
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
    @Test void openApiRoutesMatchBothControllers() throws Exception {
        Set<String> actual = new TreeSet<>();
        for (Class<?> controller : List.of(FlowController.class,ExecutionController.class)) {
            String base = controller.getAnnotation(RequestMapping.class).value()[0];
            for (var method : controller.getDeclaredMethods()) {
                var get = method.getAnnotation(GetMapping.class);
                var post = method.getAnnotation(PostMapping.class);
                if (get != null) actual.add("get " + base + (get.value().length == 0 ? "" : get.value()[0]));
                if (post != null) actual.add("post " + base + (post.value().length == 0 ? "" : post.value()[0]));
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
                Map.entry("Input",FlowDefinition.Input.class),
                Map.entry("Retry",FlowDefinition.Retry.class),
                Map.entry("Concurrency",FlowDefinition.Concurrency.class),
                Map.entry("Schedule",FlowDefinition.Schedule.class));
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
    }
}
