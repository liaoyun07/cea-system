package com.project.platform.runtime.definition;

import com.project.platform.runtime.model.FlowDefinition;
import com.project.platform.runtime.model.WorkflowException;
import com.project.platform.runtime.scheduler.ScheduleCalculator;
import java.time.Instant;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class ControlFlowTest {
    private String loop() {return """
            inputs: {clients: {type: ARRAY, defaultValue: [{id: a, clusters: [edge]}]}}
            tasks:
              - id: clients
                type: core.Loop
                loop:
                  values: {source: INPUT, name: clients}
                  concurrency: 2
                  outputs: {ids: {source: ITEM, path: [value, id]}}
                tasks:
                  - id: train
                    type: platform.Application
                    timeout: PT1M
                    container:
                      applicationId: train
                      version: v1
                      candidateClusters: {source: ITEM, path: [value, clusters]}
                      command: [echo, hello]
                      parameters: {ID: {source: ITEM, path: [value, id]}}
            outputs: {ids: {source: TASK_OUTPUT, taskId: clients, port: ids}}
            """;}
    @Test void loopUsesOneBindingModelAndTypedItemPaths() {
        var flow=parse(loop());var json=new JsonCodec();assertEquals(flow,json.flow(json.write(flow)));
        var resolver=new BindingResolver();var context=java.util.Map.<String,Object>of("inputs",java.util.Map.of(),"vars",java.util.Map.of(),"outputs",java.util.Map.of(),"item",java.util.Map.of("index",0,"value",java.util.Map.of("id","a","clusters",java.util.List.of("edge"))));
        assertEquals("a",resolver.resolve(new FlowDefinition.ItemRef(java.util.List.of("value","id")),context));
        assertEquals(java.util.List.of("edge"),resolver.resolve(flow.tasks().getFirst().tasks().getFirst().container().candidateClusters(),context));
        assertThrows(WorkflowException.class,()->resolver.resolve(new FlowDefinition.ItemRef(java.util.List.of("value","missing")),context));
    }
    @Test void staticCandidateArraysNormalizeToLiteralAndKeepSourceOnRoundTrip() {
        var flow=parse(loop().replace("candidateClusters: {source: ITEM, path: [value, clusters]}","candidateClusters: [edge]"));
        assertEquals(new FlowDefinition.Literal(java.util.List.of("edge")),flow.tasks().getFirst().tasks().getFirst().container().candidateClusters());
        assertEquals(flow,new JsonCodec().flow(new JsonCodec().write(flow)));
    }
    @Test void loopRejectsScopeLeaksUnboundedConcurrencyAndImplicitChildOutputs() {
        for(String source:java.util.List.of(loop().replace("concurrency: 2","concurrency: 0"),loop().replace("concurrency: 2","concurrency: 101"),
                loop().replace("name: clients}","name: missing}"),loop().replace("port: ids}","port: _loopValues}"),
                loop().replace("outputs: {ids: {source: TASK_OUTPUT, taskId: clients, port: ids}}","outputs: {ids: {source: ITEM, path: [index]}}"),
                loop()+"variables: {bad: {source: ITEM, path: [value]}}\n"))assertThrows(WorkflowException.class,()->parse(source));
        assertThrows(WorkflowException.class,()->parse(loop().replace("outputs: {ids: {source: TASK_OUTPUT, taskId: clients, port: ids}}","outputs: {ids: {source: TASK_OUTPUT, taskId: train, port: model.pt}}")));
    }
    @Test void loopCollectionsAreBoundedArraysAndCandidatesAreValidatedAfterBinding() {
        for(String inner:java.util.List.of("core.Loop, loop: {values: {source: LITERAL, value: [a]}}","core.Repeat, repeat: {iterations: {source: LITERAL, value: 2}}"))
            assertThrows(WorkflowException.class,()->parse("tasks: [{id: outer, type: core.Loop, loop: {values: {source: LITERAL, value: [a]}}, tasks: [{id: inner, type: "+inner+", tasks: [{id: leaf, type: core.Log, message: x}]}]}]"));
        assertEquals(java.util.List.of(),FlowValidator.loopValues(java.util.List.of()));
        for(Object value:java.util.List.of("[]",java.util.Map.of("a",1),java.util.Collections.nCopies(1001,0)))assertThrows(WorkflowException.class,()->FlowValidator.loopValues(value));
        for(Object value:java.util.List.of("edge",java.util.List.of(),java.util.List.of("edge","edge"),java.util.List.of("../edge")))assertThrows(WorkflowException.class,()->FlowValidator.candidateClusters(value));
    }
    private String repeat() {return """
            tasks:
              - id: rounds
                type: core.Repeat
                repeat:
                  iterations: {source: LITERAL, value: 2}
                  initial: {model: {source: LITERAL, value: seed}}
                  feedback: {model: {source: TASK_OUTPUT, taskId: train, port: message}}
                tasks: [{id: train, type: core.Log, message: '{{ outputs.rounds.model }}-x'}]
            outputs: {model: {source: TASK_OUTPUT, taskId: rounds, port: model}}
            """;}
    @Test void repeatKeepsExplicitBindingsAndRejectsAmbiguousState() {
        assertEquals(java.util.Set.of("model"),parse(repeat()).tasks().getFirst().repeat().initial().keySet());
        assertThrows(WorkflowException.class,()->parse(repeat().replace("initial: {model:","initial: {other:")));
        assertThrows(WorkflowException.class,()->parse(repeat().replace("initial: {model:","initial: {iterationCount:").replace("feedback: {model:","feedback: {iterationCount:")));
        assertThrows(WorkflowException.class,()->parse(repeat().replace("type: core.Repeat","type: core.Sequential")));
    }
    @Test void repeatDoesNotExposeChildOutputsOutsideItsIteration() {
        assertThrows(WorkflowException.class,()->parse(repeat().replace("outputs: {model: {source: TASK_OUTPUT, taskId: rounds, port: model}}","outputs: {model: {source: TASK_OUTPUT, taskId: train, port: message}}")));
        assertThrows(WorkflowException.class,()->parse(repeat().replace("initial: {model: {source: LITERAL, value: seed}}","initial: {model: {source: TASK_OUTPUT, taskId: train, port: message}}")));
        assertThrows(WorkflowException.class,()->parse(repeat().replace("tasks: [{id: train, type: core.Log, message: '{{ outputs.rounds.model }}-x'}]","tasks: [{id: choice, type: core.If, condition: 'true', then: [{id: train, type: core.Log, message: x}]}]")));
    }
    @Test void repeatRejectsNestingAndDoesNotInferDependencies() {
        assertThrows(WorkflowException.class,()->parse(repeat().replace("tasks: [{id: train, type: core.Log, message: '{{ outputs.rounds.model }}-x'}]","tasks: [{id: nested, type: core.Repeat, repeat: {iterations: {source: LITERAL, value: 2}}, tasks: [{id: train, type: core.Log, message: x}]}]")));
        assertThrows(WorkflowException.class,()->parse(repeat().replace("iterations: {source: LITERAL, value: 2}","iterations: {source: INPUT, name: missing}")));
    }
    private final FlowParser parser=new FlowParser(new FlowValidator(new TemplateRenderer()));
    private FlowDefinition parse(String body) { return parser.parse("schemaVersion: 1\nnamespace: lab\nid: graph\n"+body); }
    @Test void dagAcceptsReverseOrderAndRejectsCyclesAndNonSiblingDependencies() {
        String dag="tasks: [{id: dag, type: core.Dag, tasks: [{id: b, type: core.Log, message: b, dependsOn: [a]}, {id: a, type: core.Log, message: a}]}]";
        assertEquals(3,parse(dag).allTasks().size());
        for(String broken:new String[]{dag.replace("[a]","[missing]"),dag.replace("[a]","[b]"),dag.replace("[a]","[a, a]"),
                dag.replace("message: a}","message: a, dependsOn: [b]}"),dag.replace("core.Dag","core.Parallel")})
            assertThrows(WorkflowException.class,()->parse(broken));
    }
    @Test void branchChildrenAreUniqueAndCannotCarryLeafPolicies() {
        String branch="tasks: [{id: select, type: core.If, condition: 'true', then: [{id: a, type: core.Log, message: yes}], else: [{id: b, type: core.Sleep, duration: PT1S}]}]";
        assertEquals(3,parse(branch).allTasks().size());
        assertThrows(WorkflowException.class,()->parse(branch.replace("id: b","id: a")));
        assertThrows(WorkflowException.class,()->parse(branch.replace("condition: 'true'","condition: 'true', timeout: PT1S")));
        assertThrows(WorkflowException.class,()->parse("tasks: [{id: p, type: core.Parallel}]"));
        assertThrows(WorkflowException.class,()->parse("tasks: [{id: p}]"));
        assertThrows(WorkflowException.class,()->parse("tasks: [{id: p, type: core.Log, message: hi, tasks: [{id: child, type: core.Log, message: hi}]}]"));
    }
    @Test void nestedMainOutputsAndIfResultHaveExplicitPorts() {
        var flow=parse("tasks: [{id: choice, type: core.If, condition: 'true', then: [{id: leaf, type: core.Log, message: hi}]}]\noutputs: {choice: {source: TASK_OUTPUT, taskId: choice, port: evaluationResult}}\n");
        assertEquals(2,flow.allTasks().size());
        assertThrows(WorkflowException.class,()->parse("tasks: [{id: choice, type: core.If, condition: 'true', then: [{id: leaf, type: core.Log, message: hi}]}]\noutputs: {choice: {source: TASK_OUTPUT, taskId: choice, port: message}}\n"));
    }
    @Test void concurrencyHasPositiveLimitAndOnlyQueueOrFail() {
        String base="tasks: [{id: one, type: core.Log, message: hi}]\nconcurrency: {limit: 2}\n";
        assertEquals(FlowDefinition.Behavior.QUEUE,parse(base).concurrency().behavior());
        assertThrows(WorkflowException.class,()->parse(base.replace("limit: 2","limit: 0")));
        assertThrows(WorkflowException.class,()->parse(base.replace("limit: 2","limit: 2, behavior: CANCEL")));
    }
    @Test void scheduleRequiresSixFieldsZoneAndUsableInputs() {
        String base="tasks: [{id: one, type: core.Log, message: hi}]\nschedule: {cron: '0 * * * * *', timezone: Asia/Shanghai}\n";
        assertFalse(parse(base).schedule().disabled());
        assertThrows(WorkflowException.class,()->parse(base.replace("0 * * * * *","* * * * *")));
        assertThrows(WorkflowException.class,()->parse(base.replace("Asia/Shanghai","invalid")));
        assertThrows(WorkflowException.class,()->parse(base+"inputs: {name: {type: STRING, required: true}}\n"));
        assertThrows(WorkflowException.class,()->parse(base+"variables: {a: {source: VARIABLE, name: b}, b: {source: VARIABLE, name: a}}\n"));
    }
    @Test void cronUsesTimezoneAndSkipsNonexistentDstTime() {
        var local=new FlowDefinition.Schedule("0 0 8 * * *","Asia/Shanghai",false,null);
        assertEquals(Instant.parse("2026-01-01T00:00:00Z"),ScheduleCalculator.next(local,Instant.parse("2025-12-31T23:59:59Z")));
        var dst=new FlowDefinition.Schedule("0 30 2 * * *","America/New_York",false,null);
        assertEquals(Instant.parse("2026-03-09T06:30:00Z"),ScheduleCalculator.next(dst,Instant.parse("2026-03-08T05:00:00Z")));
    }
}
