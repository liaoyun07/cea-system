package com.project.platform.dataflow.execution;

import com.project.platform.foundation.identity.AccessPolicy.Actor;
import com.project.platform.resource.catalog.ResourceException;
import com.project.platform.resource.storage.ObjectStorage;
import com.project.platform.runtime.model.ExecutionState;
import com.project.platform.runtime.model.ExecutionRecord;
import com.project.platform.runtime.model.WorkflowException;
import java.util.Map;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.json.JsonMapper;

/** Bounded, authorized reads of existing output artifacts. Does not ingest or recompute metrics. */
public final class ExecutionOutputService {
    public static final int MAX_JSON_BYTES=262144;
    public record OutputSource(String id,java.util.List<String> ports) {}
    public static final class Unavailable extends RuntimeException {
        public Unavailable(Exception cause){super("output storage is unavailable; check the namespace storage configuration",cause);}
    }
    private final FlowExecutionService executions;
    private final ObjectStorage storage;
    private final JsonMapper json=JsonMapper.builder().enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
            .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION).build();
    public ExecutionOutputService(FlowExecutionService executions,ObjectStorage storage) {
        this.executions=executions;this.storage=storage;
    }
    public Map<?,?> readJson(Actor actor,String namespace,String executionId,String taskRunId,String port) {
        var execution=executions.get(actor,namespace,executionId);
        var task=executions.tasks(actor,namespace,executionId).stream().filter(t->t.id().equals(taskRunId)).findFirst()
                .orElseThrow(()->new WorkflowException(WorkflowException.Kind.NOT_FOUND,"task run not found in execution"));
        if(task.state()!=ExecutionState.SUCCESS)throw new WorkflowException(WorkflowException.Kind.CONFLICT,"task output is not committed successfully");
        int attempt=executions.attempts(actor,namespace,executionId,taskRunId).stream().filter(a->a.state()==ExecutionState.SUCCESS)
                .mapToInt(a->a.attemptNo()).max().orElseThrow(()->new WorkflowException(WorkflowException.Kind.NOT_FOUND,"successful attempt not found"));
        return readCommittedJson(execution,task,attempt,port);
    }
    /** Package-local reuse after namespace authorization and successful-attempt lookup, never an arbitrary URI. */
    Map<?,?> readCommittedJson(ExecutionRecord execution,ExecutionRecord.TaskRun task,int attempt,String port) {
        var definition=execution.definition().allTasks().stream().filter(t->t.id().equals(task.taskId())).findFirst().orElseThrow();
        if(!execution.id().equals(task.executionId()))throw WorkflowException.invalid("task","execution mismatch");
        if(port==null || !port.endsWith(".json") || definition.container()==null || !definition.container().outputFiles().contains(port))
            throw WorkflowException.invalid("port","must be a declared JSON output file");
        if(task.state()!=ExecutionState.SUCCESS)throw new WorkflowException(WorkflowException.Kind.CONFLICT,"task output is not committed successfully");
        if(!(task.outputs().get(port) instanceof String uri))throw new WorkflowException(WorkflowException.Kind.NOT_FOUND,"output port has no published file");
        byte[] bytes;
        try {bytes=storage.readPublished(execution.namespace(),execution.id(),task.id(),attempt,port,uri,MAX_JSON_BYTES);}
        catch(ResourceException ex){throw ex;}
        catch(Exception ex){throw new Unavailable(ex);}
        try {
            Object value=json.readValue(bytes,Object.class);
            if(value instanceof Map<?,?> object) {
                if(object.values().stream().anyMatch(v->v instanceof Number number && !Double.isFinite(number.doubleValue())))
                    throw WorkflowException.invalid("output","numeric fields must be finite");
                return object;
            }
        } catch(tools.jackson.core.JacksonException ex) {
            throw WorkflowException.invalid("output","file must contain one valid JSON object");
        }
        throw WorkflowException.invalid("output","file must contain one valid JSON object");
    }
    public java.util.List<OutputSource> declarations(Actor actor,String namespace,String executionId) {
        return executions.get(actor,namespace,executionId).definition().allTasks().stream()
                .filter(task->task.container()!=null && !task.container().outputFiles().isEmpty())
                .map(task->new OutputSource(task.id(),task.container().outputFiles())).toList();
    }
    /** Resolve one successful Flow output back to its committed task artifact; never read an arbitrary URI. */
    public Map<?,?> terminalResult(Actor actor,String namespace,String executionId) {
        var execution=executions.get(actor,namespace,executionId);
        if(execution.state()!=ExecutionState.SUCCESS)throw WorkflowException.conflict("execution is not successful");
        Object uri=execution.outputs().get("terminal_result");
        if(!(uri instanceof String))throw WorkflowException.invalid("terminal_result","published JSON artifact required");
        for(var task:executions.tasks(actor,namespace,executionId)) {
            var definition=execution.definition().allTasks().stream().filter(t->t.id().equals(task.taskId())).findFirst().orElseThrow();
            if(task.state()!=ExecutionState.SUCCESS || definition.container()==null)continue;
            for(String port:definition.container().outputFiles())
                if(port.endsWith(".json") && uri.equals(task.outputs().get(port)))return readJson(actor,namespace,executionId,task.id(),port);
        }
        throw WorkflowException.invalid("terminal_result","no successful declared JSON artifact matches this execution output");
    }
}
