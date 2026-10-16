package com.project.platform.runtime.model;

import java.util.List;

/** Measured container costs for one Kubernetes Job, never requested resource limits. */
public record JobResourceUsage(String jobName,String jobUid,String namespace,String podUid,List<Container> containers) {
    public record Container(String name,String status,Double cpuCoreSeconds,Double memoryByteSeconds,
                            Double durationSeconds,Long peakMemoryBytes,Integer samples) {}
    public boolean complete() { return containers.size()==3 && containers.stream().allMatch(c->"COMPLETE".equals(c.status())); }
}
