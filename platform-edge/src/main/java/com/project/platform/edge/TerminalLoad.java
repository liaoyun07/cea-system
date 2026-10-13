package com.project.platform.edge;

import java.time.Instant;
import java.util.List;
import java.util.Map;

/** Load generation and measurements; never a second task execution model. */
public final class TerminalLoad {
    private TerminalLoad() {}
    public record PolicyPair(String local,String dqn) {}
    public record Profile(String label,Map<String,PolicyPair> policies) {}
    public record PinnedPolicy(String id,int revision) {}
    public record PinnedPair(PinnedPolicy local,PinnedPolicy dqn) {}
    public record Start(String profileId,List<String> terminals,double meanIntervalSeconds,long seed,String inputSize,String strategy) {}
    public record Config(String profileId,String label,List<String> terminals,double meanIntervalSeconds,long seed,
                         String inputSize,Map<String,PinnedPair> policies) {}
    public record Run(String id,Config config,int activePhase,boolean sending,Instant createdAt,Instant stoppedAt) {}
    public record Phase(int number,String strategy,Instant beganAt,Instant endedAt) {}
    public record Resource(Double cpuSeconds,double sampleSeconds,long memoryBytes,double cpuCores,long memoryLimitBytes,
                           String loadRunId,boolean sending,int pendingRequests) {}
    public record Device(EdgeAccess.Terminal terminal,Resource resource,Instant sampledAt,String loadRunId) {}
    public record Command(String runId,boolean sending,double meanIntervalSeconds,long seed,String inputSize) {}
    public record Compute(String runId,String requestId,Map<String,Object> file) {}
    public record Report(String runId,String requestId,double elapsedSeconds,String outcome,String error) {}
    public record Request(String terminalId,String requestId,Integer phase,String executionId,Instant acceptedAt,
                          Instant finishedAt,Double elapsedSeconds,String outcome,String error) {}
    public record Sample(String terminalId,Instant sampledAt,Resource resource) {}
    public record Snapshot(Run run,List<Phase> phases,List<Request> requests,List<Sample> samples) {}
}
