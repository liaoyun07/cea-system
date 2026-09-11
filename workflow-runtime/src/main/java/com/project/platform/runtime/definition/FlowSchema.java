package com.project.platform.runtime.definition;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSubTypes;
import com.project.platform.runtime.model.FlowDefinition;
import java.lang.reflect.*;
import java.util.*;

/** Structural editing schema derived from the execution model. FlowValidator remains the semantic authority. */
public final class FlowSchema {
    public Map<String,Object> generate() {
        var definitions=new LinkedHashMap<String,Object>();
        var root=new LinkedHashMap<String,Object>();
        root.put("$schema","https://json-schema.org/draft/2020-12/schema");
        root.putAll(describe(FlowDefinition.class,definitions));
        root.put("$defs",definitions);
        root.put("description","Structural Flow schema. Validate and preview with the server before saving; resource availability is checked at execution.");
        return root;
    }

    private Map<String,Object> describe(Type type,Map<String,Object> definitions) {
        if(type instanceof ParameterizedType generic) {
            var arguments=generic.getActualTypeArguments();
            if(generic.getRawType()==List.class)return Map.of("type","array","items",describe(arguments[0],definitions));
            if(generic.getRawType()==Map.class)return Map.of("type","object","additionalProperties",describe(arguments[1],definitions));
        }
        if(type==Object.class)return Map.of();
        if(type==String.class)return Map.of("type","string");
        if(type==int.class || type==Integer.class)return Map.of("type","integer");
        if(type==Boolean.class || type==boolean.class)return Map.of("type","boolean");
        if(!(type instanceof Class<?> cls))throw new IllegalStateException("Unsupported Flow schema type: "+type);
        if(cls.isEnum())return Map.of("type","string","enum",Arrays.stream(cls.getEnumConstants()).map(Object::toString).toList());
        String name=cls.getSimpleName();
        var reference=Map.<String,Object>of("$ref","#/$defs/"+name);
        if(definitions.containsKey(name))return reference;
        var schema=new LinkedHashMap<String,Object>();
        definitions.put(name,schema); // Publish before descending into recursive Task lists.
        var subTypes=cls.getAnnotation(JsonSubTypes.class);
        if(subTypes!=null) {
            schema.put("oneOf",Arrays.stream(subTypes.value()).map(sub -> describe(sub.value(),definitions)).toList());
        } else if(cls.isRecord()) {
            var properties=new LinkedHashMap<String,Object>();
            var required=new ArrayList<String>();
            for(var component:cls.getRecordComponents()) {
                var property=component.getAccessor().getAnnotation(JsonProperty.class);
                String field=property==null?component.getName():property.value();
                Map<String,Object> shape=describe(component.getGenericType(),definitions);
                if(field.equals("candidateClusters"))shape=Map.of("anyOf",List.of(shape,Map.of("type","array","items",Map.of("type","string"))));
                if(cls==FlowDefinition.Task.class && field.equals("type"))shape=Map.of("type","string","enum",FlowValidator.taskTypes().stream().sorted().toList());
                if(cls==FlowDefinition.Input.class && field.equals("values"))shape=Map.of("type","array","items",Map.of("type","string"),"minItems",1,"uniqueItems",true);
                if(cls==FlowDefinition.class && field.equals("schemaVersion"))shape=Map.of("const",1);
                if(component.getType().isPrimitive())required.add(field);
                else shape=Map.of("anyOf",List.of(shape,Map.of("type","null")));
                properties.put(field,shape);
            }
            if(FlowDefinition.Binding.class.isAssignableFrom(cls)) {
                var sub=Arrays.stream(FlowDefinition.Binding.class.getAnnotation(JsonSubTypes.class).value())
                        .filter(candidate->candidate.value()==cls).findFirst().orElseThrow();
                properties.put("source",Map.of("const",sub.name()));required.add("source");
            }
            schema.put("type","object");schema.put("properties",properties);schema.put("additionalProperties",false);
            if(!required.isEmpty())schema.put("required",required);
        } else throw new IllegalStateException("Unsupported Flow schema class: "+cls);
        return reference;
    }
}
