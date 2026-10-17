package com.project.platform.runtime.execution;

import com.project.platform.runtime.definition.JsonCodec;
import com.project.platform.runtime.model.*;
import org.junit.jupiter.api.Test;
import java.time.Instant;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class ExecutionResourceUsageTest {
    private final Instant start=Instant.parse("2026-10-17T00:00:00Z");
    private final FlowDefinition flow=new JsonCodec().read("""
            {"schemaVersion":1,"namespace":"lab","id":"resources","tasks":[
              {"id":"one","type":"platform.Application","container":{"applicationId":"app","version":"v1"}},
              {"id":"two","type":"platform.Application","container":{"applicationId":"app","version":"v1"}}]}
            """,FlowDefinition.class);
    private ExecutionRecord execution(ExecutionState state) {
        return new ExecutionRecord("e","lab","resources",1,"user",state,flow,Map.of(),Map.of(),Map.of(),start,start,
                state.terminal()?start.plusSeconds(10):null,null,null,null,null);
    }
    private ExecutionRecord.TaskRun task(String id,ExecutionState state,int end) {
        return new ExecutionRecord.TaskRun(id,"e",id,0,state,Map.of(),start,state.terminal()?start.plusSeconds(end):null,
                null,FlowDefinition.Phase.MAIN,null,null,0);
    }
    private JobResourceUsage usage(boolean full) {
        return new JobResourceUsage("job","uid","lab","pod",List.of(
                new JobResourceUsage.Container("files-in","COMPLETE",1d,1073741824d,2d,100L,21),
                new JobResourceUsage.Container("task","COMPLETE",2d,2147483648d,4d,200L,41),
                new JobResourceUsage.Container("files-out",full?"COMPLETE":"MISSING",full?1d:null,full?1073741824d:null,full?2d:null,full?100L:null,full?21:null)));
    }
    private ExecutionRecord.Attempt attempt(String task,int no,ExecutionState state,JobResourceUsage usage) {
        return new ExecutionRecord.Attempt(task,no,state,start,start.plusSeconds(5),null,usage);
    }
    @Test void sumsParallelAndFailedRetriesButDividesMemoryByWallWindowIncludingCleanup() {
        var result=ExecutionResourceUsage.summarize(execution(ExecutionState.SUCCESS),
                List.of(task("one",ExecutionState.SUCCESS,10),task("two",ExecutionState.SUCCESS,20)),
                List.of(attempt("one",1,ExecutionState.FAILED,usage(true)),attempt("one",2,ExecutionState.SUCCESS,usage(true)),
                        attempt("two",1,ExecutionState.SUCCESS,usage(true))));
        assertEquals("COMPLETE",result.status());assertEquals(3,result.attempts());assertEquals(3,result.completeJobs());
        assertEquals(12d,result.cpuCoreSeconds());assertEquals(12d,result.memoryGiBSeconds());
        assertEquals(20d,result.durationSeconds());assertEquals(0.6,result.averageMemoryGiB());
    }
    @Test void missingAndHistoricalDataAreNeverReportedAsZeroOrComplete() {
        var tasks=List.of(task("one",ExecutionState.SUCCESS,10));
        var partial=ExecutionResourceUsage.summarize(execution(ExecutionState.SUCCESS),tasks,List.of(attempt("one",1,ExecutionState.SUCCESS,usage(false))));
        assertEquals("INCOMPLETE",partial.status());assertNull(partial.cpuCoreSeconds());assertNull(partial.averageMemoryGiB());
        assertEquals(3d,partial.observedCpuCoreSeconds());assertEquals(3d,partial.observedMemoryGiBSeconds());
        var old=ExecutionResourceUsage.summarize(execution(ExecutionState.SUCCESS),tasks,List.of(attempt("one",1,ExecutionState.SUCCESS,null)));
        assertEquals("UNAVAILABLE",old.status());assertNull(old.observedCpuCoreSeconds());
    }
    @Test void activeExecutionDoesNotExposeCompletedJobsAsFinalTotals() {
        var result=ExecutionResourceUsage.summarize(execution(ExecutionState.RUNNING),List.of(task("one",ExecutionState.RUNNING,10)),
                List.of(attempt("one",1,ExecutionState.FAILED,usage(true))));
        assertEquals("RUNNING",result.status());assertNull(result.cpuCoreSeconds());assertNull(result.durationSeconds());
        assertEquals(4d,result.observedCpuCoreSeconds());
    }
    @Test void persistentDeploymentIsNotAnUncollectedJob() {
        var services=new JsonCodec().read(new JsonCodec().write(flow).replace("platform.Application","platform.Deployment"),FlowDefinition.class);
        var execution=new ExecutionRecord("e","lab","resources",1,"user",ExecutionState.SUCCESS,services,Map.of(),Map.of(),Map.of(),start,start,start.plusSeconds(10),null,null,null,null);
        var result=ExecutionResourceUsage.summarize(execution,List.of(task("one",ExecutionState.SUCCESS,10)),List.of(attempt("one",1,ExecutionState.SUCCESS,null)));
        assertEquals("NOT_APPLICABLE",result.status());assertEquals(0,result.attempts());assertNull(result.cpuCoreSeconds());
    }
}
