package com.project.platform.dataflow.execution;

import com.project.platform.resource.storage.ObjectStorage;
import com.project.platform.runtime.execution.ExecutionService;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/** Post-execution storage maintenance; S3 calls never hold an execution database transaction. */
public final class ExecutionArtifactCleanup {
    private static final Logger LOG=LoggerFactory.getLogger(ExecutionArtifactCleanup.class);
    private final ExecutionService executions;
    private final ObjectStorage storage;
    private final Set<String> names;
    public ExecutionArtifactCleanup(ExecutionService executions,ObjectStorage storage,Set<String> names) {
        this.executions=executions;this.storage=storage;this.names=Set.copyOf(names);
    }
    public void runBatch() {
        if(names.isEmpty())return;
        for(var execution:executions.temporaryOutputCleanupCandidates(100)) {
            try {
                boolean hasTemporaryOutputs=execution.definition().allTasks().stream().anyMatch(task->task.container()!=null
                        && task.container().outputFiles().stream().anyMatch(names::contains));
                if(hasTemporaryOutputs) {
                    int removed=storage.removeTemporaryOutputs(execution.namespace(),execution.id(),names);
                    if(removed>0)LOG.info("Removed {} temporary outputs for execution {}",removed,execution.id());
                }
                executions.temporaryOutputsCleaned(execution.namespace(),execution.id());
            } catch(Exception ex) {
                LOG.warn("Temporary output cleanup will retry for execution {}",execution.id(),ex);
            }
        }
    }
}
