package com.project.platform.runtime.definition;

import com.project.platform.runtime.model.FlowDefinition;
import com.project.platform.runtime.model.WorkflowException;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.dataformat.yaml.YAMLMapper;

/** YAML also accepts JSON, so both formats use exactly the same model and validator. */
public final class FlowParser {
    private final YAMLMapper mapper = YAMLMapper.builder()
            .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
            .enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
            .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
            .enable(DeserializationFeature.FAIL_ON_NULL_FOR_PRIMITIVES).build();
    private final FlowValidator validator;

    public FlowParser(FlowValidator validator) { this.validator = validator; }

    public String yaml(FlowDefinition flow) {
        validator.validate(flow);
        return mapper.writeValueAsString(flow);
    }

    public FlowDefinition parse(String source) {
        if (source == null || source.isBlank() || source.length() > 262_144) {
            throw WorkflowException.invalid("source", "must contain 1..262144 characters");
        }
        FlowDefinition flow;
        try {
            flow = mapper.readValue(source, FlowDefinition.class);
        } catch (RuntimeException ex) {
            throw WorkflowException.invalid("source", "invalid JSON/YAML or unsupported fields/types");
        }
        validator.validate(flow);
        return flow;
    }
}
