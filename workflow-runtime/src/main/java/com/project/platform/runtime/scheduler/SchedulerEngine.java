package com.project.platform.runtime.scheduler;

import com.project.platform.runtime.definition.*;
import com.project.platform.runtime.execution.ExecutionService;
import com.project.platform.runtime.model.FlowDefinition;
import com.project.platform.runtime.persistence.*;

/** Persists one due firing and its next cursor in the same DB transaction. */
public final class SchedulerEngine {
    private final JdbcExecutionStore executions;
    private final JdbcScheduleStore schedules;
    private final ExecutionService submissions;
    private final BindingResolver bindings;
    private final JsonCodec json;
    public SchedulerEngine(JdbcExecutionStore executions,JdbcScheduleStore schedules,ExecutionService submissions,BindingResolver bindings,JsonCodec json) {
        this.executions=executions;this.schedules=schedules;this.submissions=submissions;this.bindings=bindings;this.json=json;
    }
    public void configure(FlowDefinition flow,int revision,String actor) {
        executions.lockFlow(flow.namespace(),flow.id());
        schedules.configure(flow,revision,actor,executions.now());
    }
    public boolean runOnce() {
        return executions.transaction(()->{
            var candidate=schedules.peek(); if(candidate==null) return false;
            executions.lockFlow(candidate.namespace(),candidate.flowId());
            var due=schedules.lockDue(candidate); if(due==null) return false;
            var payload=due.payload(); var flow=payload.flow();
            String key="schedule:"+flow.id()+":"+due.at().toEpochMilli();
            var prepared=bindings.prepare(flow,flow.schedule().inputs());
            // A rejected gate consumes this occurrence, not the next ones; no rejected Execution is created.
            try {bindings.checks(flow,prepared);}
            catch(com.project.platform.runtime.model.WorkflowException ex) {
                System.getLogger(SchedulerEngine.class.getName()).log(System.Logger.Level.WARNING,"Scheduled execution blocked: {0}/{1}: {2}",flow.namespace(),flow.id(),ex.getMessage());
                schedules.advance(due,ScheduleCalculator.next(flow.schedule(),executions.now()));return true;
            }
            submissions.submit(flow,payload.revision(),payload.actor(),key,json.hash(payload),prepared);
            schedules.advance(due,ScheduleCalculator.next(flow.schedule(),executions.now()));
            return true;
        });
    }
}
