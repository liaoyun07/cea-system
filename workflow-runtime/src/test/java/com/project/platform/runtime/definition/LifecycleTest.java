package com.project.platform.runtime.definition;

import com.project.platform.runtime.executor.ExecutionReducer;
import com.project.platform.runtime.model.FlowDefinition;
import com.project.platform.runtime.model.WorkflowException;
import java.time.Instant;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class LifecycleTest {
    private final FlowParser parser=new FlowParser(new FlowValidator(new TemplateRenderer()));
    private FlowDefinition parse(String body) { return parser.parse("schemaVersion: 1\nnamespace: lab\nid: lifecycle\n"+body); }
    @Test void validatesRetryDurationsAndTaskSpecificFields() {
        String task="tasks: [{id: one, type: core.Sleep, duration: PT1S, timeout: PT2S, retry: {type: constant, maxAttempts: 2, interval: PT0.1S}}]";
        assertEquals(2,parse(task).tasks().getFirst().retry().maxAttempts());
        for(String invalid:new String[]{task.replace("constant","random"),task.replace("maxAttempts: 2","maxAttempts: 0"),
                task.replace("PT0.1S","PT0S"),task.replace("PT2S","invalid"),task.replace("duration: PT1S","message: hi"),
                task.replace("core.Sleep","core.Log")}) assertThrows(WorkflowException.class,()->parse(invalid));
    }
    @Test void idsAreUniqueAcrossHandlersAndSleepHasNoMessageOutput() {
        assertThrows(WorkflowException.class,()->parse("tasks: [{id: one, type: core.Log, message: hi}]\nfinally: [{id: one, type: core.Log, message: bye}]"));
        assertThrows(WorkflowException.class,()->parse("tasks: [{id: one, type: core.Sleep, duration: PT1S}]\noutputs: {x: {source: TASK_OUTPUT, taskId: one, port: message}}"));
    }
    @Test void reducerCountsAttempts() {
        var flow=parse("tasks: [{id: one, type: core.Log, message: hi, retry: {type: constant, maxAttempts: 2, interval: PT1S}}]\nerrors: [{id: handler, type: core.Log, message: error}]\nfinally: [{id: cleanup, type: core.Log, message: bye}]");
        var reducer=new ExecutionReducer();
        assertEquals(Instant.EPOCH.plusSeconds(1),reducer.retryAt(flow.tasks().getFirst(),1,Instant.EPOCH));
        assertNull(reducer.retryAt(flow.tasks().getFirst(),2,Instant.EPOCH));
    }
}
