package com.project.platform.dataflow.execution;

import com.project.platform.foundation.identity.AccessPolicy.Actor;
import com.project.platform.resource.catalog.ResourceException;
import com.project.platform.runtime.model.ExecutionRecord.Attempt;
import com.project.platform.runtime.model.ExecutionState;
import com.project.platform.runtime.model.WorkflowException;
import java.time.Duration;
import java.time.Instant;
import java.util.*;

/** Query-only aggregation of committed SDK reports. No pod-duration or dataset-size fallback. */
public final class ExecutionMeasurementService {
    private static final org.slf4j.Logger LOG=org.slf4j.LoggerFactory.getLogger(ExecutionMeasurementService.class);
    public static final String REPORT="cea-measurement.json";
    public record View(String status,Long inputBytes,Long outputBytes,Double activeSeconds,Double bytesPerSecond) {
        static View unavailable(String status) {return new View(status,null,null,null,null);}
    }
    record Sample(Instant start,Instant end,long inputBytes,long outputBytes) {}
    private final FlowExecutionService executions;
    private final ExecutionOutputService outputs;
    private final boolean clockSynchronized;
    public ExecutionMeasurementService(FlowExecutionService executions,ExecutionOutputService outputs,boolean clockSynchronized) {
        this.executions=executions;this.outputs=outputs;this.clockSynchronized=clockSynchronized;
    }
    public View get(Actor actor,String namespace,String id) {
        var execution=executions.get(actor,namespace,id); // authorization before any artifact access
        if(execution.state()!=ExecutionState.SUCCESS)return View.unavailable("NOT_SUCCESSFUL");
        var tasks=executions.tasks(actor,namespace,id);
        if(tasks.stream().anyMatch(t->!t.state().terminal()))return View.unavailable("INCOMPLETE");
        var applicationIds=new HashSet<String>();
        execution.definition().allTasks().stream().filter(t->"platform.Application".equals(t.type())).forEach(t->applicationIds.add(t.id()));
        var algorithms=tasks.stream().filter(t->applicationIds.contains(t.taskId()) && t.state()!=ExecutionState.SKIPPED).toList();
        if(algorithms.isEmpty())return View.unavailable("NO_ALGORITHM");
        if(!clockSynchronized)return View.unavailable("CLOCK_UNCONFIRMED");
        var samples=new ArrayList<Sample>();
        try {
            for(var task:algorithms) {
                if(task.state()!=ExecutionState.SUCCESS || !task.outputs().containsKey(REPORT))return View.unavailable("INCOMPLETE");
                var attempt=executions.attempts(actor,namespace,id,task.id()).stream().filter(a->a.state()==ExecutionState.SUCCESS)
                        .max(Comparator.comparingInt(Attempt::attemptNo)).orElseThrow(()->new IllegalArgumentException("missing successful attempt"));
                samples.add(parse(outputs.readCommittedJson(execution,task,attempt.attemptNo(),REPORT),attempt));
            }
            return aggregate(samples);
        } catch(ExecutionOutputService.Unavailable ex) {return View.unavailable("STORAGE_UNAVAILABLE");}
        catch(WorkflowException | ResourceException | IllegalArgumentException | ArithmeticException | java.time.DateTimeException ex) {
            LOG.warn("Algorithm measurement rejected for execution {}: {}",id,ex.getMessage());
            return View.unavailable("INVALID");
        }
    }
    static Sample parse(Map<?,?> report,Attempt attempt) {
        if(!report.keySet().equals(Set.of("startedAt","endedAt","durationNs","inputs","outputs")))throw new IllegalArgumentException("report fields");
        if(!(report.get("startedAt") instanceof String startText) || !(report.get("endedAt") instanceof String endText))throw new IllegalArgumentException("timestamps required");
        Instant start=Instant.parse(startText),end=Instant.parse(endText);
        long duration=integer(report.get("durationNs")),wall=Duration.between(start,end).toNanos();
        if(duration<=0 || wall<=0 || Math.abs(Math.subtractExact(wall,duration))>Math.max(1_000_000,duration/1000))
            throw new IllegalArgumentException("invalid or stepped clock");
        // MySQL timestamps have microsecond precision; tolerate at most 1 ms at the boundary.
        if(attempt.startedAt()==null || attempt.endedAt()==null || start.isBefore(attempt.startedAt().minusMillis(1)) || end.isAfter(attempt.endedAt().plusMillis(1)))
            throw new IllegalArgumentException("report "+start+".."+end+" outside successful attempt "+attempt.startedAt()+".."+attempt.endedAt());
        return new Sample(start,end,files(report.get("inputs")),files(report.get("outputs")));
    }
    private static long integer(Object value) {
        if(!(value instanceof Byte || value instanceof Short || value instanceof Integer || value instanceof Long))throw new IllegalArgumentException("integer required");
        long number=((Number)value).longValue();
        if(number<0)throw new IllegalArgumentException("nonnegative required");
        return number;
    }
    private static long files(Object value) {
        if(!(value instanceof List<?> files) || files.size()>1024)throw new IllegalArgumentException("bounded file list required");
        long bytes=0;var paths=new HashSet<String>();
        for(Object item:files) {
            if(!(item instanceof Map<?,?> file) || !file.keySet().equals(Set.of("path","bytes")) || !(file.get("path") instanceof String path)
                    || !path.startsWith("/") || !paths.add(path) || path.endsWith("/"+REPORT))throw new IllegalArgumentException("invalid file entry");
            bytes=Math.addExact(bytes,integer(file.get("bytes")));
        }
        return bytes;
    }
    static View aggregate(List<Sample> samples) {
        if(samples.isEmpty())return View.unavailable("NO_ALGORITHM");
        var ordered=samples.stream().sorted(Comparator.comparing(Sample::start)).toList();
        Instant start=ordered.getFirst().start(),end=start;
        long input=0,output=0,nanos=0;
        for(var sample:ordered) {
            input=Math.addExact(input,sample.inputBytes());output=Math.addExact(output,sample.outputBytes());
            if(sample.start().isAfter(end)) {nanos=Math.addExact(nanos,Duration.between(start,end).toNanos());start=sample.start();}
            if(sample.end().isAfter(end))end=sample.end();
        }
        nanos=Math.addExact(nanos,Duration.between(start,end).toNanos());
        if(nanos<=0)throw new IllegalArgumentException("positive activity duration required");
        double seconds=nanos/1_000_000_000.0,rate=Math.addExact(input,output)/seconds;
        return new View("AVAILABLE",input,output,seconds,rate);
    }
}
