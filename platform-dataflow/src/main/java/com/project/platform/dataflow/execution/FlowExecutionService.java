package com.project.platform.dataflow.execution;

import com.project.platform.dataflow.definition.JdbcFlowRepository;
import com.project.platform.foundation.identity.AccessPolicy;
import com.project.platform.foundation.identity.AccessPolicy.Actor;
import com.project.platform.foundation.identity.AccessPolicy.Action;
import com.project.platform.runtime.definition.BindingResolver;
import com.project.platform.runtime.definition.JsonCodec;
import com.project.platform.runtime.execution.ExecutionService;
import com.project.platform.runtime.model.ExecutionRecord;
import com.project.platform.runtime.model.WorkflowException;
import java.util.List;
import java.util.Map;

public final class FlowExecutionService {
    public record Request(String flowId, Integer revision, Map<String, Object> inputs) {}
    private final JdbcFlowRepository flows;
    private final ExecutionService executions;
    private final BindingResolver bindings;
    private final JsonCodec json;
    private final AccessPolicy access;

    public FlowExecutionService(JdbcFlowRepository flows, ExecutionService executions, BindingResolver bindings,
                                JsonCodec json, AccessPolicy access) {
        this.flows = flows; this.executions = executions; this.bindings = bindings; this.json = json; this.access = access;
    }

    public String submit(Actor actor, String namespace, String requestKey, Request request) {
        return submitScoped(actor,namespace,requestKey,request,"USER",false);
    }
    public String submitPolicy(Actor actor,String namespace,String requestKey,Request request) {
        return submitScoped(actor,namespace,requestKey,request,"EDGE_POLICY",false);
    }
    public String webhook(Actor actor,String namespace,String flowId,String key,Map<String,Object> inputs) {
        if(key==null || key.isBlank() || key.length()>120)throw WorkflowException.invalid("Idempotency-Key","1..120 characters required");
        return submitScoped(actor,namespace,"webhook:"+key,new Request(flowId,null,inputs),"USER",true);
    }
    private String submitScoped(Actor actor,String namespace,String requestKey,Request request,String scope,boolean webhook) {
        access.require(actor, namespace, Action.EXECUTE);
        if(requestKey!=null && requestKey.startsWith("schedule:")) throw WorkflowException.invalid("requestKey","schedule: prefix is reserved");
        if(!webhook && requestKey!=null && requestKey.startsWith("webhook:"))throw WorkflowException.invalid("requestKey","webhook: prefix is reserved");
        if (request == null || request.flowId() == null) throw WorkflowException.invalid("flowId", "required");
        if (request.revision() != null && request.revision() < 1) throw WorkflowException.invalid("revision", "must be positive");
        // Hash the original request, not the current latest revision or derived defaults.
        String hash = json.hash(request);
        String existing = executions.findSubmission(namespace, actor.name(), requestKey, hash);
        if (existing != null) return existing;
        return executions.transaction(()->{
        flows.requireScope(namespace,request.flowId(),scope);
        var flow = flows.get(namespace, request.flowId(), request.revision());
        if(webhook && !Boolean.TRUE.equals(flow.definition().webhook()))throw WorkflowException.invalid("webhook","not enabled for this flow");
        var prepared = bindings.prepare(flow.definition(), request.inputs());
        return executions.submit(flow.definition(), flow.revision(), actor.name(), requestKey, hash, prepared);
        });
    }

    public ExecutionRecord get(Actor actor, String namespace, String id) {
        access.require(actor, namespace, Action.READ);
        return executions.get(namespace, id);
    }
    public void remove(Actor actor,String namespace,String id) {
        access.require(actor,namespace,Action.WRITE);executions.remove(namespace,id);
    }
    public void cancel(Actor actor,String namespace,String id) {
        access.require(actor,namespace,Action.EXECUTE);
        executions.cancel(namespace,id);
    }
    public List<ExecutionRecord> list(Actor actor, String namespace, int limit, int offset) {
        access.require(actor, namespace, Action.READ);
        return executions.list(namespace, limit, offset);
    }
    public com.project.platform.runtime.execution.ExecutionService.Overview overview(Actor actor,String namespace,int days) {
        access.require(actor,namespace,Action.READ);
        return executions.overview(namespace,days);
    }
    public List<ExecutionRecord.TaskRun> tasks(Actor actor, String namespace, String id) {
        access.require(actor, namespace, Action.READ);
        return executions.tasks(namespace, id);
    }
    public List<ExecutionRecord.Attempt> attempts(Actor actor, String namespace, String id, String taskRunId) {
        access.require(actor, namespace, Action.READ);
        return executions.attempts(namespace, id, taskRunId);
    }
    public List<ExecutionRecord.LogEntry> logs(Actor actor, String namespace, String id, long afterId, int limit) {
        access.require(actor, namespace, Action.READ);
        return executions.logs(namespace, id, afterId, limit);
    }
}
