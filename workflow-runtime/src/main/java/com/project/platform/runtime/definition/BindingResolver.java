package com.project.platform.runtime.definition;

import com.project.platform.runtime.model.FlowDefinition;
import com.project.platform.runtime.model.FlowDefinition.*;
import com.project.platform.runtime.model.WorkflowException;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

public final class BindingResolver {
    private final TemplateRenderer renderer=new TemplateRenderer();
    public record Prepared(Map<String, Object> inputs, Map<String, Object> variables) {}

    public void checks(FlowDefinition flow,Prepared prepared) {
        var context=Map.<String,Object>of("inputs",prepared.inputs(),"vars",prepared.variables());
        for(var check:flow.checks())if(!"true".equals(renderer.render(check.when(),context).trim()))
            throw WorkflowException.invalid("checks",check.message());
    }

    public Prepared prepare(FlowDefinition flow, Map<String, Object> supplied) {
        Map<String, Object> values = supplied == null ? Map.of() : supplied;
        for (String key : values.keySet()) {
            if (!flow.inputs().containsKey(key)) throw WorkflowException.invalid("inputs." + key, "unknown input");
        }
        Map<String, Object> inputs = new LinkedHashMap<>();
        flow.inputs().forEach((name, spec) -> {
            Object value = values.containsKey(name) ? values.get(name) : spec.defaultValue();
            if (value == null && spec.required()) throw WorkflowException.invalid("inputs." + name, "required");
            validateInput(name, spec, value);
            inputs.put(name, value);
        });
        Map<String, Object> variables = new LinkedHashMap<>();
        for (String name : flow.variables().keySet()) variable(name, flow, inputs, variables, new HashSet<>());
        return new Prepared(FlowDefinition.immutable(inputs), FlowDefinition.immutable(variables));
    }

    private Object variable(String name, FlowDefinition flow, Map<String, Object> inputs,
                            Map<String, Object> variables, Set<String> resolving) {
        if (variables.containsKey(name)) return variables.get(name);
        if (!resolving.add(name)) throw WorkflowException.invalid("variables." + name, "cyclic reference");
        Binding binding = flow.variables().get(name);
        if (binding instanceof VariableRef ref) variable(ref.name(), flow, inputs, variables, resolving);
        Object value = resolve(binding, inputs, variables, Map.of());
        variables.put(name, value);
        resolving.remove(name);
        return value;
    }

    public Map<String, Object> outputs(Map<String, Binding> bindings, Map<String, Object> inputs,
                                       Map<String, Object> variables, Map<String, Map<String, Object>> tasks) {
        return outputs(bindings,inputs,variables,tasks,Map.of());
    }
    public Map<String, Object> outputs(Map<String, Binding> bindings, Map<String, Object> inputs,
                                       Map<String, Object> variables, Map<String, Map<String, Object>> tasks,Map<String,Object> item) {
        Map<String, Object> result = new LinkedHashMap<>();
        bindings.forEach((name, binding) -> result.put(name, resolve(binding, inputs, variables, tasks,item)));
        return result;
    }

    public Object resolve(Binding binding, Map<String, Object> inputs, Map<String, Object> variables,
                          Map<String, Map<String, Object>> tasks) {
        return resolve(binding,inputs,variables,tasks,Map.of());
    }
    @SuppressWarnings("unchecked") public Object resolve(Binding binding,Map<String,Object> context) {
        return resolve(binding,(Map<String,Object>)context.get("inputs"),(Map<String,Object>)context.get("vars"),
                (Map<String,Map<String,Object>>)context.get("outputs"),(Map<String,Object>)context.getOrDefault("item",Map.of()));
    }
    public Object resolve(Binding binding, Map<String, Object> inputs, Map<String, Object> variables,
                          Map<String, Map<String, Object>> tasks,Map<String,Object> item) {
        if (binding == null) throw WorkflowException.invalid("binding", "must not be null");
        return switch (binding) {
            case Literal literal -> literal.value();
            case InputRef ref -> required(inputs, ref.name(), "inputs");
            case VariableRef ref -> required(variables, ref.name(), "variables");
            case ItemRef ref -> {
                if(item.isEmpty())throw WorkflowException.invalid("item","outside Loop scope");
                Object value=item;
                for(String part:ref.path()) {
                    if(!(value instanceof Map<?,?> object) || !object.containsKey(part))throw WorkflowException.invalid("item","unknown path component: "+part);
                    value=object.get(part);
                }
                yield value;
            }
            case TaskOutputRef ref -> {
                Map<String, Object> output = tasks.get(ref.taskId());
                if (output == null) throw WorkflowException.invalid("outputs." + ref.taskId(), "task has not succeeded");
                yield required(output, ref.port(), "outputs." + ref.taskId());
            }
        };
    }

    private Object required(Map<String, Object> values, String key, String path) {
        if (!values.containsKey(key)) throw WorkflowException.invalid(path + "." + key, "unknown reference");
        return values.get(key);
    }

    public static void validateInput(String name, Input spec, Object value) {
        validateType(name, spec.type(), value);
        if (value != null && spec.type() == InputType.SELECT && (spec.values() == null || !spec.values().contains(value)))
            throw WorkflowException.invalid("inputs." + name, "must match one of values");
    }

    public static void validateType(String name, InputType type, Object value) {
        if (type == null) throw WorkflowException.invalid("inputs." + name, "type is required");
        if (value == null) return;
        boolean valid = switch (type) {
            case STRING, SELECT -> value instanceof String;
            case INTEGER -> value instanceof Byte || value instanceof Short || value instanceof Integer
                    || value instanceof Long || value instanceof java.math.BigInteger;
            case NUMBER -> value instanceof Number n && Double.isFinite(n.doubleValue());
            case BOOLEAN -> value instanceof Boolean;
            case OBJECT -> value instanceof Map<?, ?>;
            case ARRAY -> value instanceof java.util.List<?>;
        };
        if (!valid) throw WorkflowException.invalid("inputs." + name, "expected " + type);
    }
}
