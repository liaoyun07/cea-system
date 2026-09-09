package com.project.platform.runtime.definition;

import com.project.platform.runtime.model.FlowDefinition;
import com.project.platform.runtime.model.FlowDefinition.*;
import com.project.platform.runtime.model.WorkflowException;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class DefinitionTest {
    private final TemplateRenderer renderer = new TemplateRenderer();
    private final FlowValidator validator = new FlowValidator(renderer);
    private final FlowParser parser = new FlowParser(validator);
    private final JsonCodec json = new JsonCodec();
    private final BindingResolver resolver = new BindingResolver();

    private FlowDefinition flow(Map<String,Input> inputs, Map<String,Binding> variables, Map<String,Binding> outputs) {
        return new FlowDefinition(1,"lab","test","test",Map.of(),inputs,variables,
                List.of(new Task("one","core.Log","{{ inputs.name }}",null,null,null,null,null,null,null,null)),outputs,null,null,null,null);
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
                List.of(new Task("same","core.Log","a",null,null,null,null,null,null,null,null),new Task("same","core.Log","b",null,null,null,null,null,null,null,null)),null,null,null,null,null);
        assertThrows(WorkflowException.class, () -> validator.validate(duplicate));
        FlowDefinition unsupported = new FlowDefinition(1,"lab","test",null,null,null,null,
                List.of(new Task("one","core.Http","a",null,null,null,null,null,null,null,null)),null,null,null,null,null);
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
}
