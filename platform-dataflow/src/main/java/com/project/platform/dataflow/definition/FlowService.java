package com.project.platform.dataflow.definition;

import com.project.platform.foundation.identity.AccessPolicy;
import com.project.platform.foundation.identity.AccessPolicy.Actor;
import com.project.platform.foundation.identity.AccessPolicy.Action;
import com.project.platform.runtime.definition.FlowParser;
import com.project.platform.runtime.definition.FlowValidator;
import com.project.platform.runtime.definition.FlowSchema;
import com.project.platform.runtime.definition.BindingResolver;
import com.project.platform.runtime.definition.JsonCodec;
import com.project.platform.runtime.model.FlowDefinition;
import com.project.platform.runtime.execution.ExecutionService;
import com.project.platform.runtime.model.WorkflowException;
import java.util.*;

public final class FlowService {
    public record ImportEntry(Integer expectedRevision,String source) {}
    public record Preview(FlowDefinition definition,Map<String,Object> inputs,Map<String,Object> variables) {}
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
        var flow = validate(actor,namespace,flowId,source);
        if(scope.equals("EDGE_POLICY") && flow.schedule()!=null && !flow.schedule().disabled())
            throw WorkflowException.invalid("schedule","policy Flow cannot enable an independent schedule");
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
        return search(actor,namespace,null,null,null,limit,offset);
    }
    public List<FlowRevision.Summary> search(Actor actor,String namespace,String query,String labelKey,String labelValue,int limit,int offset) {
        access.require(actor, namespace, Action.READ);
        ExecutionService.page(limit, offset);
        if(query!=null && query.length()>200)throw WorkflowException.invalid("q","at most 200 characters");
        if((labelKey==null)!=(labelValue==null) || labelKey!=null && (labelKey.isBlank() || labelKey.length()>100 || labelValue.length()>200))
            throw WorkflowException.invalid("labels","labelKey and labelValue must be supplied together, up to 100/200 characters");
        return repository.search(namespace,query==null?"":query,labelKey,labelValue,limit,offset);
    }
    public Map<String,Object> schema(Actor actor,String namespace) {
        access.require(actor,namespace,Action.READ);
        return new FlowSchema().generate();
    }
    public FlowDefinition validate(Actor actor,String namespace,String flowId,String source) {
        access.require(actor,namespace,Action.WRITE);
        var flow=parser.parse(source);
        if(!namespace.equals(flow.namespace()) || !flowId.equals(flow.id()))throw WorkflowException.invalid("source","namespace/id must match route");
        if(flow.schedule()!=null && !flow.schedule().disabled())access.require(actor,namespace,Action.EXECUTE);
        return flow;
    }
    public Preview preview(Actor actor,String namespace,String flowId,String source,Map<String,Object> inputs) {
        var flow=validate(actor,namespace,flowId,source);
        var prepared=new BindingResolver().prepare(flow,inputs);
        new BindingResolver().checks(flow,prepared);
        return new Preview(flow,prepared.inputs(),prepared.variables());
    }
    public String export(Actor actor,String namespace,String flowId,Integer revision,String format) {
        var flow=get(actor,namespace,flowId,revision);
        return switch(format) {
            case "source" -> flow.source();
            case "yaml" -> parser.yaml(flow.definition());
            case "json" -> new JsonCodec().write(flow.definition());
            default -> throw WorkflowException.invalid("format","source, yaml or json required");
        };
    }
    public List<FlowRevision> importFlows(Actor actor,String namespace,List<ImportEntry> entries) {
        access.require(actor,namespace,Action.WRITE);
        if(entries==null || entries.isEmpty() || entries.size()>20)throw WorkflowException.invalid("flows","1..20 entries required");
        var sources=new TreeMap<String,ImportEntry>();
        long size=0;
        for(var entry:entries) {
            if(entry==null || entry.source()==null)throw WorkflowException.invalid("flows","source required");
            size+=entry.source().length();
            if(size>1_048_576)throw WorkflowException.invalid("flows","total source must not exceed 1048576 characters");
            var flow=parser.parse(entry.source());
            if(sources.putIfAbsent(flow.id(),entry)!=null)throw WorkflowException.invalid("flows","duplicate Flow id");
        }
        return executions.transaction(()->{
            var saved=new ArrayList<FlowRevision>();
            sources.forEach((id,entry)->saved.add(save(actor,namespace,id,entry.expectedRevision(),entry.source())));
            return List.copyOf(saved);
        });
    }
    public List<String> applicationReferences(Actor actor,String namespace,String applicationId,String version) {
        access.require(actor,namespace,Action.READ);return repository.applicationReferences(namespace,applicationId,version);
    }
}
