package com.project.platform.deployment.application;

import java.util.*;

/** Immutable contract descriptor; registration does not inspect or execute the image. */
public record ApplicationVersion(String applicationId,String version,String image,Map<String,Parameter> parameters) {
    public ApplicationVersion { parameters=Collections.unmodifiableMap(new LinkedHashMap<>(parameters==null?Map.of():parameters)); }
    public enum ValueType { STRING, INTEGER, NUMBER, BOOLEAN }
    public record Parameter(ValueType type,Boolean required,Object defaultValue,List<Object> choices,DatasetRule dataset) {
        public Parameter { required=Boolean.TRUE.equals(required);choices=choices==null?List.of():List.copyOf(choices); }
    }
    public record DatasetRef(String datasetId,String version) {
        public String key() { return datasetId+"/"+version; }
    }
    public record DatasetRule(String format,List<DatasetRef> allowed) {
        public DatasetRule { allowed=allowed==null?List.of():List.copyOf(allowed); }
    }
}
