package com.project.platform.edge;

import com.project.platform.dataflow.definition.FlowService;
import com.project.platform.dataflow.execution.FlowExecutionService;
import com.project.platform.edge.EdgeAccess.*;
import com.project.platform.foundation.identity.AccessPolicy;
import com.project.platform.foundation.identity.AccessPolicy.*;
import com.project.platform.resource.catalog.ResourceCatalogService;
import com.project.platform.resource.catalog.ResourceCatalog;
import com.project.platform.runtime.definition.FlowValidator;
import com.project.platform.runtime.definition.JsonCodec;
import com.project.platform.runtime.execution.ExecutionService;
import com.project.platform.runtime.model.ExecutionRecord;
import com.project.platform.runtime.model.WorkflowException;
import java.util.*;
import org.springframework.transaction.support.TransactionTemplate;

/** Business ingress. Never executes tasks or copies the engine's execution state. */
public final class EdgeAccessService {
    private final JdbcEdgeRepository repository;
    private final TransactionTemplate transactions;
    private final AccessPolicy access;
    private final ResourceCatalogService resources;
    private final FlowService flows;
    private final FlowExecutionService executions;
    private final JsonCodec json;
    public EdgeAccessService(JdbcEdgeRepository repository,TransactionTemplate transactions,AccessPolicy access,
                             ResourceCatalogService resources,FlowService flows,FlowExecutionService executions,JsonCodec json) {
        this.repository=repository;this.transactions=transactions;this.access=access;this.resources=resources;
        this.flows=flows;this.executions=executions;this.json=json;
    }
    public Gateway putGateway(Actor actor,String ns,String id,GatewayRegistration value) {
        authorize(actor,ns,Action.WRITE);identifier(id);
        if(value==null || value.principal()==null || value.principal().isBlank() || value.principal().length()>100)
            throw WorkflowException.invalid("principal","registered CONNECT account required");
        edgeCluster(reader(actor),ns,value.clusterId(),false);
        return transactions.execute(status->repository.putGateway(ns,id,value));
    }
    public Terminal putTerminal(Actor actor,String ns,String id,TerminalRegistration value) {
        authorize(actor,ns,Action.WRITE);identifier(id);
        if(value==null) throw WorkflowException.invalid("terminal","registration required");
        repository.gateway(ns,value.gatewayId());
        return transactions.execute(status->repository.putTerminal(ns,id,value));
    }
    public List<Gateway> gateways(Actor actor,String ns,int limit,int offset) {
        authorize(actor,ns,Action.READ);ExecutionService.page(limit,offset);return repository.gateways(ns,limit,offset);
    }
    public List<Terminal> terminals(Actor actor,String ns,int limit,int offset) {
        authorize(actor,ns,Action.READ);ExecutionService.page(limit,offset);return repository.terminals(ns,limit,offset);
    }
    public PolicyView putPolicy(Actor actor,String ns,String id,PolicyRequest value) {
        authorize(actor,ns,Action.WRITE);identifier(id);
        if(value==null) throw WorkflowException.invalid("policy","definition required");
        if(value.enabled()) access.require(actor,ns,Action.EXECUTE);
        identifier(value.eventType());edgeCluster(reader(actor),ns,value.clusterId(),false);
        return transactions.execute(status->{
            var policy=repository.putPolicy(ns,id,value);
            var flow=flows.savePolicy(actor,ns,id,value.expectedRevision(),value.source());
            return new PolicyView(policy,flow);
        });
    }
    public PolicyView policy(Actor actor,String ns,String id) {
        authorize(actor,ns,Action.READ);identifier(id);
        return transactions.execute(status->new PolicyView(repository.policy(ns,id),flows.getPolicy(actor,ns,id,null)));
    }
    public List<Policy> policies(Actor actor,String ns,int limit,int offset) {
        authorize(actor,ns,Action.READ);ExecutionService.page(limit,offset);return repository.policies(ns,limit,offset);
    }
    /** Read projection only: runtime owns pagination, state, timestamps and output snapshots. */
    public List<ProcessingRecord> processingRecords(Actor actor,String ns,String policyId,
                                                   com.project.platform.runtime.model.ExecutionState state,int limit,int offset) {
        authorize(actor,ns,Action.READ);ExecutionService.page(limit,offset);
        if(policyId!=null) identifier(policyId);
        var policies=repository.processingPolicies(ns,policyId);
        var events=new HashMap<String,String>();policies.forEach(p->events.put(p.id(),p.eventType()));
        return executions.listForFlows(actor,ns,policies.stream().map(Policy::id).toList(),state,limit,offset).stream()
                .map(e->new ProcessingRecord(e,events.get(e.flowId()),repository.submissionOrigin(ns,e.id()))).toList();
    }
    public Gateway heartbeat(Actor actor,String ns) {
        var gateway=connected(actor,ns);return repository.heartbeat(ns,gateway.id());
    }
    public Terminal terminalHeartbeat(Actor actor,String ns,String id) {
        var gateway=connected(actor,ns);terminal(ns,id,gateway,false);return repository.terminalHeartbeat(ns,id);
    }
    public String submit(Actor actor,String ns,String terminal,String key,FlowExecutionService.Request request) {
        if(request==null) throw WorkflowException.invalid("request","required");
        return accept(actor,ns,terminal,key,Map.of("kind","FLOW","body",request),gateway ->
                executions.submit(executionActor(actor),ns,UUID.randomUUID().toString(),request));
    }
    public String event(Actor actor,String ns,String terminal,String key,Event event) {
        if(event==null) throw WorkflowException.invalid("event","required");
        identifier(event.eventType());
        return accept(actor,ns,terminal,key,Map.of("kind","EVENT","body",event),gateway->{
            var policy=repository.matchingPolicy(ns,gateway.clusterId(),event.eventType());
            if(!policy.enabled()) throw WorkflowException.conflict("policy is disabled");
            return executions.submitPolicy(executionActor(actor),ns,UUID.randomUUID().toString(),
                    new FlowExecutionService.Request(policy.id(),null,event.inputs()));
        });
    }
    private String accept(Actor actor,String ns,String id,String key,Object request,java.util.function.Function<Gateway,String> submit) {
        var gateway=connected(actor,ns);
        if(key==null || key.isBlank() || key.length()>128) throw WorkflowException.invalid("requestKey","requires 1..128 characters");
        String hash=json.hash(request);
        return transactions.execute(status->{
            terminal(ns,id,gateway,true);
            var prior=repository.receipt(ns,id,key);
            if(prior!=null) {
                if(!prior.hash().equals(hash)) throw WorkflowException.conflict("requestKey already used with different content");
                return prior.executionId();
            }
            String execution=submit.apply(gateway);
            repository.record(ns,id,key,hash,execution);
            repository.terminalHeartbeat(ns,id);
            return execution;
        });
    }
    public ExecutionRecord result(Actor actor,String ns,String id,String execution) {
        var gateway=connected(actor,ns);terminal(ns,id,gateway,false);
        repository.requireExecution(ns,id,execution);
        return executions.get(executionActor(actor),ns,execution);
    }
    public Map<?,?> terminalResult(Actor actor,String ns,String id,String execution,
                                  com.project.platform.dataflow.execution.ExecutionOutputService outputs) {
        result(actor,ns,id,execution); // Registered gateway, terminal ownership and original receipt first.
        return outputs.terminalResult(executionActor(actor),ns,execution);
    }
    /** Accepted work retains its authority if ingress is later disabled. No new submission is authorized here. */
    public Origin executionOrigin(Actor actor,String ns,String execution) {
        authorize(actor,ns,Action.CONNECT);
        return repository.executionOrigin(ns,execution,actor.name());
    }
    public Actor workerActor(Actor actor,String ns,String execution) {
        executionOrigin(actor,ns,execution);
        return new Actor(actor.name(),Set.of(ns),Set.of(Action.READ,Action.EXECUTE));
    }
    private Gateway connected(Actor actor,String ns) {
        authorize(actor,ns,Action.CONNECT);
        var gateway=repository.gatewayForPrincipal(ns,actor.name());
        if(!gateway.enabled()) throw new AccessPolicy.Forbidden();
        edgeCluster(reader(actor),ns,gateway.clusterId(),true);
        return gateway;
    }
    private void terminal(String ns,String id,Gateway gateway,boolean lock) {
        identifier(id);var value=repository.terminal(ns,id,lock);
        if(!value.enabled() || !value.gatewayId().equals(gateway.id())) throw new AccessPolicy.Forbidden();
    }
    private void edgeCluster(Actor actor,String ns,String id,boolean active) {
        var cluster=resources.cluster(actor,ns,id);
        if(cluster.kind()!=ResourceCatalog.Kind.EDGE) throw WorkflowException.invalid("clusterId","EDGE cluster required");
        if(active && !cluster.enabled()) throw WorkflowException.conflict("edge cluster is disabled");
    }
    // Authority is narrowed to the already checked namespace by the called service; never supplied by JSON.
    private Actor reader(Actor actor) { return new Actor(actor.name(),actor.namespaces(),Set.of(Action.READ)); }
    private Actor executionActor(Actor actor) { return new Actor(actor.name(),actor.namespaces(),Set.of(Action.READ,Action.EXECUTE)); }
    private void authorize(Actor actor,String ns,Action action) { access.require(actor,ns,action);identifier(ns); }
    private void identifier(String id) { FlowValidator.identifier(id,"id"); }
}
