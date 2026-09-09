package com.project.platform.dataflow.definition;

import com.project.platform.runtime.model.FlowDefinition;
import java.time.Instant;

public record FlowRevision(String namespace, String flowId, int revision, String source,
                           FlowDefinition definition, String createdBy, Instant createdAt) {
    public record Summary(String namespace, String flowId, int revision, String createdBy, Instant createdAt) {}
}
