package com.project.platform.edge;

import com.project.platform.dataflow.definition.FlowRevision;
import java.time.Instant;
import java.util.Map;

/** Access/management data only. Execution state and results belong to runtime. */
public final class EdgeAccess {
    /** Trusted ingress provenance for Worker dispatch, not caller-supplied task parameters. */
    public record Origin(String terminalId,String clusterId) {}
    private EdgeAccess() {}
    public record GatewayRegistration(String clusterId,String principal,boolean enabled) {}
    public record Gateway(String id,String clusterId,String principal,boolean enabled,Instant lastSeenAt) {}
    public record TerminalRegistration(String gatewayId,boolean enabled) {}
    public record Terminal(String id,String gatewayId,boolean enabled,Instant lastSeenAt) {}
    public record PolicyRequest(String clusterId,String eventType,boolean enabled,Integer expectedRevision,String source) {}
    public record Policy(String id,String clusterId,String eventType,boolean enabled) {}
    public record PolicyView(Policy policy,FlowRevision flow) {}
    public record Event(String eventType,Map<String,Object> inputs) {}
}
