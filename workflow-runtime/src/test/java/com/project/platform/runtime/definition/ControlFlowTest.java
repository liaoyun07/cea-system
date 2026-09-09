package com.project.platform.runtime.definition;

import com.project.platform.runtime.model.FlowDefinition;
import com.project.platform.runtime.model.WorkflowException;
import com.project.platform.runtime.scheduler.ScheduleCalculator;
import java.time.Instant;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class ControlFlowTest {
    private final FlowParser parser=new FlowParser(new FlowValidator(new TemplateRenderer()));
    private FlowDefinition parse(String body) { return parser.parse("schemaVersion: 1\nnamespace: lab\nid: graph\n"+body); }
    @Test void dagAcceptsReverseOrderAndRejectsCyclesAndNonSiblingDependencies() {
        String dag="tasks: [{id: dag, type: core.Dag, tasks: [{id: b, type: core.Log, message: b, dependsOn: [a]}, {id: a, type: core.Log, message: a}]}]";
        assertEquals(3,parse(dag).allTasks().size());
        for(String broken:new String[]{dag.replace("[a]","[missing]"),dag.replace("[a]","[b]"),dag.replace("[a]","[a, a]"),
                dag.replace("message: a}","message: a, dependsOn: [b]}"),dag.replace("core.Dag","core.Parallel")})
            assertThrows(WorkflowException.class,()->parse(broken));
    }
    @Test void branchChildrenAreUniqueAndCannotCarryLeafPolicies() {
        String branch="tasks: [{id: select, type: core.If, condition: 'true', then: [{id: a, type: core.Log, message: yes}], else: [{id: b, type: core.Sleep, duration: PT1S}]}]";
        assertEquals(3,parse(branch).allTasks().size());
        assertThrows(WorkflowException.class,()->parse(branch.replace("id: b","id: a")));
        assertThrows(WorkflowException.class,()->parse(branch.replace("condition: 'true'","condition: 'true', timeout: PT1S")));
        assertThrows(WorkflowException.class,()->parse("tasks: [{id: p, type: core.Parallel}]"));
        assertThrows(WorkflowException.class,()->parse("tasks: [{id: p}]"));
        assertThrows(WorkflowException.class,()->parse("tasks: [{id: p, type: core.Log, message: hi, tasks: [{id: child, type: core.Log, message: hi}]}]"));
    }
    @Test void nestedMainOutputsAndIfResultHaveExplicitPorts() {
        var flow=parse("tasks: [{id: choice, type: core.If, condition: 'true', then: [{id: leaf, type: core.Log, message: hi}]}]\noutputs: {choice: {source: TASK_OUTPUT, taskId: choice, port: evaluationResult}}\n");
        assertEquals(2,flow.allTasks().size());
        assertThrows(WorkflowException.class,()->parse("tasks: [{id: choice, type: core.If, condition: 'true', then: [{id: leaf, type: core.Log, message: hi}]}]\noutputs: {choice: {source: TASK_OUTPUT, taskId: choice, port: message}}\n"));
    }
    @Test void concurrencyHasPositiveLimitAndOnlyQueueOrFail() {
        String base="tasks: [{id: one, type: core.Log, message: hi}]\nconcurrency: {limit: 2}\n";
        assertEquals(FlowDefinition.Behavior.QUEUE,parse(base).concurrency().behavior());
        assertThrows(WorkflowException.class,()->parse(base.replace("limit: 2","limit: 0")));
        assertThrows(WorkflowException.class,()->parse(base.replace("limit: 2","limit: 2, behavior: CANCEL")));
    }
    @Test void scheduleRequiresSixFieldsZoneAndUsableInputs() {
        String base="tasks: [{id: one, type: core.Log, message: hi}]\nschedule: {cron: '0 * * * * *', timezone: Asia/Shanghai}\n";
        assertFalse(parse(base).schedule().disabled());
        assertThrows(WorkflowException.class,()->parse(base.replace("0 * * * * *","* * * * *")));
        assertThrows(WorkflowException.class,()->parse(base.replace("Asia/Shanghai","invalid")));
        assertThrows(WorkflowException.class,()->parse(base+"inputs: {name: {type: STRING, required: true}}\n"));
        assertThrows(WorkflowException.class,()->parse(base+"variables: {a: {source: VARIABLE, name: b}, b: {source: VARIABLE, name: a}}\n"));
    }
    @Test void cronUsesTimezoneAndSkipsNonexistentDstTime() {
        var local=new FlowDefinition.Schedule("0 0 8 * * *","Asia/Shanghai",false,null);
        assertEquals(Instant.parse("2026-01-01T00:00:00Z"),ScheduleCalculator.next(local,Instant.parse("2025-12-31T23:59:59Z")));
        var dst=new FlowDefinition.Schedule("0 30 2 * * *","America/New_York",false,null);
        assertEquals(Instant.parse("2026-03-09T06:30:00Z"),ScheduleCalculator.next(dst,Instant.parse("2026-03-08T05:00:00Z")));
    }
}
