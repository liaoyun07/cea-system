package com.project.platform.runtime.worker;

import com.project.platform.runtime.definition.JsonCodec;
import com.project.platform.runtime.model.JobResourceUsage;
import io.fabric8.kubernetes.api.model.ContainerStatus;
import io.fabric8.kubernetes.api.model.Pod;
import io.fabric8.kubernetes.api.model.batch.v1.Job;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/** Reads the platform meter's small termination messages; never makes metrics API calls. */
final class KubernetesResourceReport {
    private static final JsonCodec JSON=new JsonCodec();
    static JobResourceUsage read(Job job,Pod pod) {
        var statuses=new ArrayList<ContainerStatus>();
        if(pod!=null && pod.getStatus()!=null) {
            if(pod.getStatus().getInitContainerStatuses()!=null)statuses.addAll(pod.getStatus().getInitContainerStatuses());
            if(pod.getStatus().getContainerStatuses()!=null)statuses.addAll(pod.getStatus().getContainerStatuses());
        }
        var containers=new ArrayList<JobResourceUsage.Container>();
        for(String name:List.of("files-in","task","files-out")) {
            var found=statuses.stream().filter(c->name.equals(c.getName())).findFirst().orElse(null);
            String message=found==null || found.getState()==null || found.getState().getTerminated()==null?null:found.getState().getTerminated().getMessage();
            containers.add(parse(name,message));
        }
        return new JobResourceUsage(job.getMetadata().getName(),job.getMetadata().getUid(),job.getMetadata().getNamespace(),
                pod==null?null:pod.getMetadata().getUid(),List.copyOf(containers));
    }
    static JobResourceUsage.Container parse(String name,String message) {
        if(message==null || message.isBlank())return missing(name,"MISSING");
        try {
            var root=JSON.map(message);
            if(!(root.get("resources") instanceof Map<?,?> values))return missing(name,"MISSING");
            if(!"COMPLETE".equals(values.get("status")))return missing(name,"INCOMPLETE");
            double cpu=number(values,"cpuCoreSeconds"),memory=number(values,"memoryByteSeconds"),duration=number(values,"durationSeconds");
            double peak=number(values,"peakMemoryBytes"),samples=number(values,"samples");
            if(duration<=0 || samples<2 || samples!=Math.rint(samples) || samples>Integer.MAX_VALUE || peak!=Math.rint(peak) || peak>Long.MAX_VALUE)
                throw new IllegalArgumentException("invalid resource summary");
            return new JobResourceUsage.Container(name,"COMPLETE",cpu,memory,duration,(long)peak,(int)samples);
        } catch(RuntimeException invalid) { return missing(name,"INVALID"); }
    }
    private static double number(Map<?,?> values,String key) {
        if(!(values.get(key) instanceof Number value) || !Double.isFinite(value.doubleValue()) || value.doubleValue()<0)
            throw new IllegalArgumentException("invalid resource value");
        return value.doubleValue();
    }
    private static JobResourceUsage.Container missing(String name,String status) {
        return new JobResourceUsage.Container(name,status,null,null,null,null,null);
    }
}
