package com.project.platform.runtime.definition;

import com.project.platform.runtime.model.FlowDefinition;
import com.project.platform.runtime.model.FlowDefinition.*;
import com.project.platform.runtime.model.WorkflowException;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class DefinitionTest {
    @Test void postCannotRetryAndSqlCannotWriteOrUseMultipleStatements() {
        String base="schemaVersion: 1\nnamespace: lab\nid: common\ntasks:\n";
        assertThrows(WorkflowException.class,()->parser.parse(base+"  - {id: post, type: core.Http, timeout: PT1S, retry: {type: constant, maxAttempts: 2, interval: PT1S}, http: {connection: c, method: POST, path: {source: LITERAL, value: /}}}\n"));
        for(String query:List.of("DELETE FROM t","SELECT 1; SELECT 2"))assertThrows(WorkflowException.class,()->parser.parse(base+"  - {id: sql, type: core.Sql, timeout: PT1S, sql: {connection: c, query: '"+query+"'}}\n"));
    }
    private String application(String extra) {return """
            schemaVersion: 1
            namespace: lab
            id: app
            tasks:
              - id: run
                type: platform.Application
                timeout: PT1M
                container:
                  applicationId: app
                  version: '1'
                  candidateClusters: [edge]
                  command: [sh, -c, 'true']
            """+extra;}
    @Test void applicationDoesNotDeriveInputsAndRoundTripsExplicitBindings() {
        var flow=parser.parse(application("""
                      parameters:
                        COUNT: {source: LITERAL, value: 2}
                      outputFiles: [model.bin]
                outputs:
                  model: {source: TASK_OUTPUT, taskId: run, port: model.bin}
                """));
        assertTrue(flow.inputs().isEmpty());assertEquals(flow,parser.parse(json.write(flow)));
    }
    @Test void applicationRejectsTraversalAndMissingTimeout() {
        assertThrows(WorkflowException.class,()->parser.parse(application("      outputFiles: ['../other']\n")));
        assertThrows(WorkflowException.class,()->parser.parse(application("").replace("    timeout: PT1M\n","")));
        assertThrows(WorkflowException.class,()->parser.parse(application("      aliases: {a: b}\n")));
    }
    @Test void terminalExecutionUsesSameApplicationButCannotAcceptClusterTargetsOrDockerAddresses() {
        String terminal=application("").replace("candidateClusters: [edge]","execution: TERMINAL");
        var flow=parser.parse(terminal);
        assertEquals(ContainerExecution.TERMINAL,flow.tasks().getFirst().container().execution());
        assertEquals(flow,parser.parse(json.write(flow)));
        assertEquals(ContainerExecution.CLUSTER,parser.parse(application("")).tasks().getFirst().container().execution());
        assertThrows(WorkflowException.class,()->parser.parse(terminal+"      candidateClusters: [edge]\n"));
        assertThrows(WorkflowException.class,()->parser.parse(terminal+"      dockerContext: arbitrary\n"));
        assertThrows(WorkflowException.class,()->parser.parse(terminal.replace("TERMINAL","DQN")));
    }
    @Test void applicationCannotReadFutureOrParallelSiblingWithoutDependency() {
        String flow=application("      parameters: {VALUE: {source: TASK_OUTPUT, taskId: later, port: message}}\n  - {id: later, type: core.Log, message: hi}\n");
        assertThrows(WorkflowException.class,()->parser.parse(flow));
        String parallel="schemaVersion: 1\nnamespace: lab\nid: app\ntasks:\n  - id: group\n    type: core.Parallel\n    tasks:\n"
                +flow.substring(flow.indexOf("  - id: run")).indent(4);
        assertThrows(WorkflowException.class,()->parser.parse(parallel));
    }
    private final TemplateRenderer renderer = new TemplateRenderer();
    private final FlowValidator validator = new FlowValidator(renderer);
    private final FlowParser parser = new FlowParser(validator);
    private final JsonCodec json = new JsonCodec();
    private final BindingResolver resolver = new BindingResolver();

    private FlowDefinition flow(Map<String,Input> inputs, Map<String,Binding> variables, Map<String,Binding> outputs) {
        return new FlowDefinition(1,"lab","test","test",Map.of(),inputs,variables,
                List.of(new Task("one","core.Log","{{ inputs.name }}",null,null,null,null,null,null,null,null,null,null,null,null,null)),outputs,null,null,null,null);
    }

    @Test void jsonAndYamlHaveTheSameModel() {
        var yaml = parser.parse("""
                schemaVersion: 1
                namespace: lab
                id: test
                inputs:
                  name: {type: STRING, required: true}
                variables:
                  value: {source: INPUT, name: name}
                tasks:
                  - {id: one, type: core.Log, message: "{{ vars.value }}"}
                outputs:
                  result: {source: TASK_OUTPUT, taskId: one, port: message}
                """);
        assertEquals(yaml, parser.parse(json.write(yaml)));
    }

    @Test void unknownFieldsAndDuplicateYamlKeysAreRejected() {
        String valid = "schemaVersion: 1\nnamespace: lab\nid: test\ntasks: [{id: one, type: core.Log, message: hi}]\n";
        assertThrows(WorkflowException.class, () -> parser.parse(valid + "compatibilityMode: true\n"));
        assertThrows(WorkflowException.class, () -> parser.parse(valid + "id: duplicate\n"));
    }

    @Test void duplicateTaskAndUnsupportedTaskAreRejected() {
        FlowDefinition duplicate = new FlowDefinition(1,"lab","test",null,null,null,null,
                List.of(new Task("same","core.Log","a",null,null,null,null,null,null,null,null,null,null,null,null,null),new Task("same","core.Log","b",null,null,null,null,null,null,null,null,null,null,null,null,null)),null,null,null,null,null);
        assertThrows(WorkflowException.class, () -> validator.validate(duplicate));
        FlowDefinition unsupported = new FlowDefinition(1,"lab","test",null,null,null,null,
                List.of(new Task("one","core.Http","a",null,null,null,null,null,null,null,null,null,null,null,null,null)),null,null,null,null,null);
        assertThrows(WorkflowException.class, () -> validator.validate(unsupported));
    }

    @Test void invalidOutputAndVariableReferencesAreRejected() {
        var inputs = Map.of("name", new Input(InputType.STRING,true,null));
        assertThrows(WorkflowException.class, () -> validator.validate(flow(inputs,Map.of(),Map.of("bad",new TaskOutputRef("missing","message")))));
        assertThrows(WorkflowException.class, () -> validator.validate(flow(inputs,Map.of("bad",new InputRef("missing")),Map.of())));
        assertThrows(WorkflowException.class, () -> validator.validate(flow(inputs,Map.of("bad",new TaskOutputRef("one","message")),Map.of())));
    }

    @Test void variableCyclesAreRejectedAndDefinitionOrderDoesNotMatter() {
        var inputs = Map.of("name",new Input(InputType.STRING,true,null));
        assertThrows(WorkflowException.class, () -> validator.validate(flow(inputs,
                Map.of("a",new VariableRef("b"),"b",new VariableRef("a")),Map.of())));
        var good = flow(inputs,Map.of("a",new VariableRef("b"),"b",new InputRef("name")),Map.of());
        validator.validate(good);
        assertEquals("Ada",resolver.prepare(good,Map.of("name","Ada")).variables().get("a"));
    }

    @Test void inputTypesDefaultsRequiredAndUnknownKeys() {
        var parsed = parser.parse("schemaVersion: 1\nnamespace: lab\nid: defaults\ninputs:\n  count: {type: INTEGER, defaultValue: 2}\ntasks: [{id: one, type: core.Log, message: hi}]");
        assertFalse(parsed.inputs().get("count").required());
        assertEquals(2, resolver.prepare(parsed, Map.of()).inputs().get("count"));
        var flow = flow(Map.of("name",new Input(InputType.STRING,true,null),"count",new Input(InputType.INTEGER,false,2)),
                Map.of(),Map.of());
        assertEquals(2,resolver.prepare(flow,Map.of("name","Ada")).inputs().get("count"));
        assertThrows(WorkflowException.class, () -> resolver.prepare(flow,Map.of()));
        assertThrows(WorkflowException.class, () -> resolver.prepare(flow,Map.of("name","Ada","count","2")));
        assertThrows(WorkflowException.class, () -> resolver.prepare(flow,Map.of("name","Ada","extra",true)));
        assertThrows(WorkflowException.class, () -> validator.validate(flow(
                Map.of("name",new Input(InputType.INTEGER,false,"wrong")),Map.of(),Map.of())));
    }

    @Test void optionalNullIsPreservedAndBindingOutputsStayTyped() {
        var definition = flow(Map.of("name",new Input(InputType.STRING,false,null)),Map.of(),Map.of());
        assertTrue(resolver.prepare(definition,Map.of()).inputs().containsKey("name"));
        Map<String,Object> output = resolver.outputs(Map.of("count",new Literal(2),"flag",new Literal(true)),
                Map.of(),Map.of(),Map.of());
        assertEquals(2,output.get("count"));
        assertEquals(true,output.get("flag"));
    }

    @Test void templatesResolvePriorOutputsAndRejectMissingReferences() {
        var context = Map.<String,Object>of("inputs",Map.of("name","Ada"),"outputs",Map.of("one",Map.of("message","Hello")));
        assertEquals("Hello Ada",renderer.render("{{ outputs.one.message }} {{ inputs.name }}",context));
        assertThrows(WorkflowException.class, () -> renderer.render("{{ outputs.future.message }}",context));
        assertThrows(WorkflowException.class, () -> renderer.render("{{ inputs.unknown }}",context));
        assertThrows(WorkflowException.class, () -> renderer.validate("{% include 'secret' %}"));
    }

    @Test void canonicalHashDoesNotDependOnMapKeyOrder() {
        var a = new java.util.LinkedHashMap<String,Object>(); a.put("a",1); a.put("b",2);
        var b = new java.util.LinkedHashMap<String,Object>(); b.put("b",2); b.put("a",1);
        assertEquals(json.hash(a),json.hash(b));
    }

    @Test void sourceSizeAndSchemaVersionAreBounded() {
        assertThrows(WorkflowException.class, () -> parser.parse("x".repeat(262145)));
        assertThrows(WorkflowException.class, () -> parser.parse("schemaVersion: 2\nnamespace: lab\nid: x\ntasks: [{id: x,type: core.Log,message: hi}]"));
    }
    @Test void offloadingRequiresExplicitTerminalEligibilityAndOneExistingBinding() {
        String source="""
                schemaVersion: 1
                namespace: lab
                id: offload
                inputs: {clusters: {type: ARRAY, required: true}}
                tasks:
                  - id: work
                    type: platform.Application
                    timeout: PT1M
                    container:
                      applicationId: app
                      version: v1
                      execution: TERMINAL
                      command: [sh, -c, 'true']
                      offload: {strategy: RULE, candidateClusters: {source: INPUT, name: clusters}}
                """;
        assertEquals(OffloadStrategy.RULE,parser.parse(source).tasks().getFirst().container().offload().strategy());
        assertThrows(WorkflowException.class,()->parser.parse(source.replace("TERMINAL","CLUSTER")));
        assertThrows(WorkflowException.class,()->parser.parse(source.replace("strategy: RULE","strategy: DQN")));
        assertThrows(WorkflowException.class,()->parser.parse(source.replace("strategy: RULE","strategy: RULE, modelVersion: v1")));
        assertThrows(WorkflowException.class,()->parser.parse(source.replace("name: clusters","name: missing")));
        assertEquals("v1",parser.parse(source.replace("strategy: RULE","strategy: DQN, modelVersion: v1")).tasks().getFirst().container().offload().modelVersion());
    }
}
