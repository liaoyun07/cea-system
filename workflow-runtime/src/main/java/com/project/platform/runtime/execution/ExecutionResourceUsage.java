package com.project.platform.runtime.execution;

import com.project.platform.runtime.model.*;
import java.time.Duration;
import java.time.Instant;
import java.util.*;
import java.util.stream.Collectors;

/** A read-time rollup of durable per-attempt costs, including failed attempts. */
public record ExecutionResourceUsage(String status,int attempts,int completeJobs,Double durationSeconds,
                                     Double cpuCoreSeconds,Double memoryGiBSeconds,Double averageMemoryGiB,
                                     Double observedCpuCoreSeconds,Double observedMemoryGiBSeconds,List<Job> jobs) {
    public record Job(String taskRunId,String taskId,int attemptNo,ExecutionState state,JobResourceUsage usage) {}
    public static ExecutionResourceUsage summarize(ExecutionRecord execution,List<ExecutionRecord.TaskRun> tasks,List<ExecutionRecord.Attempt> attempts) {
        var definitions=execution.definition().allTasks().stream().filter(t->"platform.Application".equals(t.type()) && t.container().execution()==FlowDefinition.ContainerExecution.CLUSTER)
                .map(FlowDefinition.Task::id).collect(Collectors.toSet());
        var byId=tasks.stream().collect(Collectors.toMap(ExecutionRecord.TaskRun::id,t->t));
        var jobs=new ArrayList<Job>();
        double cpu=0,memory=0;int collected=0,complete=0;
        for(var attempt:attempts) {
            var task=byId.get(attempt.taskRunId());
            if(attempt.resourceUsage()==null && !definitions.contains(task.taskId()))continue;
            var usage=attempt.resourceUsage();
            jobs.add(new Job(task.id(),task.taskId(),attempt.attemptNo(),attempt.state(),usage));
            if(usage==null)continue;
            if(usage.complete())complete++;
            for(var container:usage.containers())if("COMPLETE".equals(container.status())) {
                cpu+=container.cpuCoreSeconds();memory+=container.memoryByteSeconds();collected++;
            }
        }
        boolean ended=execution.state().terminal() && tasks.stream().allMatch(t->t.state().terminal());
        String status=jobs.isEmpty()?(definitions.isEmpty()?"NOT_APPLICABLE":ended?"UNAVAILABLE":"RUNNING"):
                !ended?"RUNNING":complete==jobs.size()?"COMPLETE":collected==0?"UNAVAILABLE":"INCOMPLETE";
        Instant last=execution.endedAt();
        // Include afterExecution tasks as well as the main execution window.
        for(var task:tasks)if(task.endedAt()!=null && (last==null || task.endedAt().isAfter(last)))last=task.endedAt();
        Double seconds=ended && last!=null && execution.startedAt()!=null?Duration.between(execution.startedAt(),last).toNanos()/1e9:null;
        Double observedCpu=collected==0?null:cpu,observedMemory=collected==0?null:memory/1073741824d;
        boolean full="COMPLETE".equals(status);
        return new ExecutionResourceUsage(status,jobs.size(),complete,seconds,full?observedCpu:null,full?observedMemory:null,
                full && seconds!=null && seconds>0?observedMemory/seconds:null,observedCpu,observedMemory,List.copyOf(jobs));
    }
}
