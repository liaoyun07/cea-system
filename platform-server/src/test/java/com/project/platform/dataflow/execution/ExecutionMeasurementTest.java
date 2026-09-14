package com.project.platform.dataflow.execution;

import com.project.platform.runtime.model.ExecutionRecord.Attempt;
import com.project.platform.runtime.model.ExecutionState;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class ExecutionMeasurementTest {
    private final Instant origin=Instant.parse("2026-09-15T00:00:00Z");
    private final Attempt attempt=new Attempt("task",2,ExecutionState.SUCCESS,origin,origin.plusSeconds(30),null);
    private Map<String,Object> report() {
        return new HashMap<>(Map.of("startedAt",origin.plusSeconds(1).toString(),"endedAt",origin.plusSeconds(3).toString(),
                "durationNs",2_000_000_000L,"inputs",List.of(Map.of("path","/in/data","bytes",40)),
                "outputs",List.of(Map.of("path","/out/result","bytes",10))));
    }
    private ExecutionMeasurementService.Sample sample(int start,int end) {
        return new ExecutionMeasurementService.Sample(origin.plusSeconds(start),origin.plusSeconds(end),40,10);
    }
    @Test void disjointAndOverlappingIntervalsUseUnionNotSumOrMaximum() {
        var value=ExecutionMeasurementService.aggregate(List.of(sample(10,12),sample(2,6),sample(1,4),sample(3,5)));
        assertEquals(7,value.activeSeconds());assertEquals(160,value.inputBytes());assertEquals(40,value.outputBytes());
        assertEquals(200.0/7,value.bytesPerSecond());assertEquals("AVAILABLE",value.status());
    }
    @Test void adjacentNestedAndIdenticalIntervalsDoNotDuplicateTime() {
        assertEquals(5,ExecutionMeasurementService.aggregate(List.of(sample(0,4),sample(0,4),sample(1,2),sample(4,5))).activeSeconds());
    }
    @Test void completeSuccessfulReportAndZeroBytesAreValid() {
        var value=ExecutionMeasurementService.parse(report(),attempt);assertEquals(40,value.inputBytes());
        var empty=report();empty.put("inputs",List.of());empty.put("outputs",List.of());
        assertEquals(0,ExecutionMeasurementService.aggregate(List.of(ExecutionMeasurementService.parse(empty,attempt))).bytesPerSecond());
    }
    @Test void actualJsonNumbersAndNanosecondTimestampsParse() {
        var json=tools.jackson.databind.json.JsonMapper.builder().build();
        var object=json.readValue("""
                {"startedAt":"2026-09-15T00:00:01.000000000Z","endedAt":"2026-09-15T00:00:01.123456789Z","durationNs":123456789,
                 "inputs":[{"path":"/in/data","bytes":209715200}],"outputs":[{"path":"/out/model","bytes":1000}]}
                """,Map.class);
        assertEquals(209715200,ExecutionMeasurementService.parse(object,attempt).inputBytes());
    }
    @Test void rejectsMissingExtraMalformedAndOutOfAttemptTimes() {
        for(var entry:List.of(Map.entry("startedAt",(Object)"bad"),Map.entry("startedAt",(Object)5),
                Map.entry("durationNs",(Object)2_000_000_000.0),Map.entry("durationNs",(Object)0L),
                Map.entry("endedAt",(Object)origin.plusSeconds(4).toString()))) {
            var invalid=report();invalid.put(entry.getKey(),entry.getValue());
            assertThrows(RuntimeException.class,()->ExecutionMeasurementService.parse(invalid,attempt));
        }
        var missing=report();missing.remove("durationNs");assertThrows(IllegalArgumentException.class,()->ExecutionMeasurementService.parse(missing,attempt));
        var extra=report();extra.put("epochs",100);assertThrows(IllegalArgumentException.class,()->ExecutionMeasurementService.parse(extra,attempt));
        assertThrows(IllegalArgumentException.class,()->ExecutionMeasurementService.parse(report(),new Attempt("task",1,ExecutionState.SUCCESS,origin.plusSeconds(5),origin.plusSeconds(6),null)));
    }
    @Test void rejectsNegativeFractionalOverflowDuplicateAndControlFiles() {
        for(Object files:List.of(List.of(Map.of("path","/in/a","bytes",-1)),List.of(Map.of("path","/in/a","bytes",1.5)),
                List.of(Map.of("path","/a","bytes",Long.MAX_VALUE),Map.of("path","/b","bytes",1)),
                List.of(Map.of("path","/a","bytes",1),Map.of("path","/a","bytes",1)),
                List.of(Map.of("path","/out/cea-measurement.json","bytes",1)),List.of(Map.of("path","relative","bytes",1)),"not array")) {
            var invalid=report();invalid.put("inputs",files);assertThrows(RuntimeException.class,()->ExecutionMeasurementService.parse(invalid,attempt));
        }
    }
    @Test void noAlgorithmDoesNotBecomeZero() {
        var value=ExecutionMeasurementService.aggregate(List.of());assertNull(value.bytesPerSecond());assertEquals("NO_ALGORITHM",value.status());
    }
}
