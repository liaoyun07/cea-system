package com.project.platform.runtime.executor;

import com.project.platform.runtime.model.FlowDefinition;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import com.project.platform.runtime.model.ExecutionRecord.TaskRun;
import com.project.platform.runtime.model.ExecutionState;

/** Pure sequential lifecycle decisions; the Executor applies them under the execution lock. */
public final class ExecutionReducer {
    public boolean ready(FlowDefinition.Task task,List<FlowDefinition.Task> siblings,String mode,Map<String,TaskRun> runs) {
        if("core.Dag".equals(mode)) return task.dependsOn().stream().allMatch(id->runs.get(id).state()==ExecutionState.SUCCESS);
        if("core.Parallel".equals(mode)) return true;
        int index=siblings.indexOf(task);
        return siblings.subList(0,index).stream().allMatch(t->runs.get(t.id()).state().terminal());
    }
    public Instant retryAt(FlowDefinition.Task task, int failedAttempt, Instant endedAt) {
        if (task.retry() == null || failedAttempt >= task.retry().maxAttempts()) return null;
        return endedAt.plus(Duration.parse(task.retry().interval()));
    }
}
