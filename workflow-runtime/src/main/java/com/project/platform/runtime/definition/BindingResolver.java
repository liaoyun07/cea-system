package com.project.platform.runtime.definition;

import com.project.platform.runtime.model.FlowDefinition;
import com.project.platform.runtime.model.FlowDefinition.*;
import com.project.platform.runtime.model.WorkflowException;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

public final class BindingResolver {
    public record Prepared(Map<String, Object> inputs, Map<String, Object> variables) {}

    public Prepared prepare(FlowDefinition flow, Map<String, Object> supplied) {
        Map<String,Object> inputs=prepareInputs(flow.inputs(),supplied);
        Map<String, Object> variables = new LinkedHashMap<>();
        for (String name : flow.variables().keySet()) variable(name, flow, inputs, variables, new HashSet<>());
        return new Prepared(inputs, FlowDefinition.immutable(variables));
    }

    public Map<String,Object> prepareInputs(Map<String,Input> definitions,Map<String,Object> supplied) {
        Map<String, Object> values = supplied == null ? Map.of() : supplied;
        for (String key : values.keySet()) {
            if (!definitions.containsKey(key)) throw WorkflowException.invalid("inputs." + key, "unknown input");
        }
        Map<String, Object> inputs = new LinkedHashMap<>();
        definitions.forEach((name, spec) -> {
            Object value = values.containsKey(name) ? values.get(name) : spec.defaultValue();
            if (value == null && spec.required()) throw WorkflowException.invalid("inputs." + name, "required");
            validateType(name, spec.type(), value);
            inputs.put(name, value);
        });
        return FlowDefinition.immutable(inputs);
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
        Map<String, Object> result = new LinkedHashMap<>();
        bindings.forEach((name, binding) -> result.put(name, resolve(binding, inputs, variables, tasks)));
        return result;
    }

    public Object resolve(Binding binding, Map<String, Object> inputs, Map<String, Object> variables,
                          Map<String, Map<String, Object>> tasks) {
        if (binding == null) throw WorkflowException.invalid("binding", "must not be null");
        return switch (binding) {
            case Literal literal -> literal.value();
            case InputRef ref -> required(inputs, ref.name(), "inputs");
            case VariableRef ref -> required(variables, ref.name(), "variables");
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

    public static void validateType(String name, InputType type, Object value) {
        if (type == null) throw WorkflowException.invalid("inputs." + name, "type is required");
        if (value == null) return;
        boolean valid = switch (type) {
            case STRING -> value instanceof String;
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
