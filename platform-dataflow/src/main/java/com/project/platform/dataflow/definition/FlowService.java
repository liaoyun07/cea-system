package com.project.platform.dataflow.definition;

import com.project.platform.foundation.identity.AccessPolicy;
import com.project.platform.foundation.identity.AccessPolicy.Actor;
import com.project.platform.foundation.identity.AccessPolicy.Action;
import com.project.platform.runtime.definition.FlowParser;
import com.project.platform.runtime.definition.FlowValidator;
import com.project.platform.runtime.execution.ExecutionService;
import com.project.platform.runtime.model.WorkflowException;
import java.util.List;

public final class FlowService {
    private final JdbcFlowRepository repository;
    private final FlowParser parser;
    private final AccessPolicy access;
    private final ExecutionService executions;
    private final com.project.platform.runtime.scheduler.SchedulerEngine scheduler;
    public FlowService(JdbcFlowRepository repository, FlowParser parser, AccessPolicy access,ExecutionService executions,com.project.platform.runtime.scheduler.SchedulerEngine scheduler) {
        this.repository = repository; this.parser = parser; this.access = access;this.executions=executions;this.scheduler=scheduler;
    }
    public FlowRevision save(Actor actor, String namespace, String flowId, Integer expectedRevision, String source) {
        return saveScoped(actor,namespace,flowId,expectedRevision,source,"USER");
    }
    public FlowRevision savePolicy(Actor actor,String namespace,String flowId,Integer expectedRevision,String source) {
        return saveScoped(actor,namespace,flowId,expectedRevision,source,"EDGE_POLICY");
    }
    private FlowRevision saveScoped(Actor actor,String namespace,String flowId,Integer expectedRevision,String source,String scope) {
        access.require(actor, namespace, Action.WRITE);
        if (expectedRevision == null || expectedRevision < 0) throw WorkflowException.invalid("expectedRevision", "non-negative integer required");
        var flow = parser.parse(source);
        if(scope.equals("EDGE_POLICY") && flow.schedule()!=null && !flow.schedule().disabled())
            throw WorkflowException.invalid("schedule","policy Flow cannot enable an independent schedule");
        if (!namespace.equals(flow.namespace()) || !flowId.equals(flow.id())) throw WorkflowException.invalid("source", "namespace/id must match route");
        if(flow.schedule()!=null && !flow.schedule().disabled()) access.require(actor,namespace,Action.EXECUTE);
        return executions.transaction(()->{
            var saved=repository.save(flow,source,expectedRevision,actor.name(),scope);
            executions.configureConcurrency(flow);
            scheduler.configure(flow,saved.revision(),actor.name());
            return saved;
        });
    }
    public FlowRevision get(Actor actor, String namespace, String flowId, Integer revision) {
        return getScoped(actor,namespace,flowId,revision,"USER");
    }
    public FlowRevision getPolicy(Actor actor,String namespace,String flowId,Integer revision) {
        return getScoped(actor,namespace,flowId,revision,"EDGE_POLICY");
    }
    private FlowRevision getScoped(Actor actor,String namespace,String flowId,Integer revision,String scope) {
        access.require(actor, namespace, Action.READ);
        FlowValidator.identifier(flowId, "flowId");
        if (revision != null && revision < 1) throw WorkflowException.invalid("revision", "must be positive");
        repository.requireScope(namespace,flowId,scope);
        return repository.get(namespace, flowId, revision);
    }
    public FlowRevision rollback(Actor actor, String namespace, String flowId, Integer expected, int targetRevision) {
        access.require(actor, namespace, Action.WRITE);
        if (targetRevision < 1) throw WorkflowException.invalid("targetRevision", "must be positive");
        repository.requireScope(namespace,flowId,"USER");
        return save(actor, namespace, flowId, expected, repository.get(namespace, flowId, targetRevision).source());
    }
    public List<FlowRevision.Summary> history(Actor actor, String namespace, String flowId, int limit, int offset) {
        access.require(actor, namespace, Action.READ);
        ExecutionService.page(limit, offset);
        repository.requireScope(namespace,flowId,"USER");
        return repository.history(namespace, flowId, limit, offset);
    }
    public List<FlowRevision.Summary> list(Actor actor, String namespace, int limit, int offset) {
        access.require(actor, namespace, Action.READ);
        ExecutionService.page(limit, offset);
        return repository.list(namespace, limit, offset);
    }
}
