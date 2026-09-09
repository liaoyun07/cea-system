package com.project.platform.deployment.application;

import com.project.platform.deployment.application.ApplicationVersion.*;
import java.math.BigDecimal;
import java.util.*;

/** Scalar contract validation for application registration. */
public final class ApplicationContractValidator {
    private ApplicationContractValidator() {}
    public static ApplicationVersion normalize(ApplicationVersion source) {
        if(source==null) throw ApplicationException.invalid("application contract required");
        identifier(source.applicationId());token(source.version(),100);
        String image=source.image();
        String component="[a-z0-9]+(?:[._-][a-z0-9]+)*";
        String repository="(?:"+component+"(?::[0-9]{1,5})?/)?"+component+"(?:/"+component+")*";
        if(image==null || image.length()>512 || !image.matches(repository+"(?::[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}|@sha256:[a-f0-9]{64})"))
            throw ApplicationException.invalid("image requires an explicit repository:tag or repository@sha256:digest without credentials");
        if(source.parameters().size()>100) throw ApplicationException.invalid("at most 100 parameters");
        var parameters=new TreeMap<String,Parameter>();
        source.parameters().forEach((name,p)->{
            if(name==null || !name.matches("[A-Za-z_][A-Za-z0-9_]{0,99}") || p==null || p.type()==null) throw ApplicationException.invalid("invalid parameter name or type");
            var choices=new ArrayList<Object>();
            if(p.choices().size()>100) throw ApplicationException.invalid("at most 100 choices per parameter");
            for(Object value:p.choices()) {
                Object normalized=scalar(p.type(),value);
                if(normalized==null || choices.contains(normalized)) throw ApplicationException.invalid("null or duplicate choice: "+name);
                choices.add(normalized);
            }
            DatasetRule dataset=p.dataset();
            if(dataset!=null) {
                if(p.type()!=ValueType.STRING || !choices.isEmpty() || dataset.allowed().isEmpty() || dataset.allowed().size()>100)
                    throw ApplicationException.invalid("dataset requires STRING, 1..100 allowed versions and no separate choices: "+name);
                token(dataset.format(),64);var seen=new HashSet<String>();
                for(var ref:dataset.allowed()) { identifier(ref.datasetId());token(ref.version(),100);if(!seen.add(ref.key())) throw ApplicationException.invalid("duplicate dataset version"); }
                dataset=new DatasetRule(dataset.format(),dataset.allowed().stream().sorted(Comparator.comparing(DatasetRef::key)).toList());
            }
            var normalized=new Parameter(p.type(),p.required(),scalar(p.type(),p.defaultValue()),choices,dataset);
            // Required values may be supplied later; a supplied default must already satisfy constraints.
            if(normalized.defaultValue()!=null) value(name,normalized,normalized.defaultValue());
            parameters.put(name,normalized);
        });
        return new ApplicationVersion(source.applicationId(),source.version(),image,parameters);
    }
    private static List<Object> choices(Parameter parameter) {
        return parameter.dataset()==null?parameter.choices():parameter.dataset().allowed().stream().map(ref->(Object)ref.key()).toList();
    }
    private static Object value(String name,Parameter parameter,Object value) {
        Object normalized=scalar(parameter.type(),value);
        if(normalized==null && parameter.required()) throw ApplicationException.invalid("required parameter: "+name);
        var allowed=choices(parameter);
        if(normalized!=null && !allowed.isEmpty() && !allowed.contains(normalized)) throw ApplicationException.invalid("value not allowed: "+name);
        return normalized;
    }
    private static Object scalar(ValueType type,Object value) {
        if(value==null) return null;
        return switch(type) {
            case STRING -> { if(!(value instanceof String text) || text.length()>8192) throw ApplicationException.invalid("expected STRING of at most 8192 characters");yield value; }
            case BOOLEAN -> { if(!(value instanceof Boolean)) throw ApplicationException.invalid("expected BOOLEAN");yield value; }
            case INTEGER -> {
                if(!(value instanceof Byte || value instanceof Short || value instanceof Integer || value instanceof Long || value instanceof java.math.BigInteger)) throw ApplicationException.invalid("expected INTEGER");
                try { yield new BigDecimal(value.toString()).longValueExact(); } catch(ArithmeticException ex) { throw ApplicationException.invalid("INTEGER outside signed 64-bit range"); }
            }
            case NUMBER -> {
                if(!(value instanceof Number n) || !Double.isFinite(n.doubleValue())) throw ApplicationException.invalid("expected finite NUMBER");
                yield new BigDecimal(value.toString()).stripTrailingZeros();
            }
        };
    }
    public static void identifier(String value) {
        if(value==null || !value.matches("[A-Za-z][A-Za-z0-9_.-]{0,99}")) throw ApplicationException.invalid("invalid identifier");
    }
    public static void token(String value,int max) {
        if(value==null || value.length()>max || !value.matches("[A-Za-z0-9][A-Za-z0-9_.-]*")) throw ApplicationException.invalid("invalid version or format");
    }
}
