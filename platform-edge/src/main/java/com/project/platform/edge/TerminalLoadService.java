package com.project.platform.edge;

import com.project.platform.edge.TerminalLoad.*;
import com.project.platform.foundation.identity.AccessPolicy;
import com.project.platform.foundation.identity.AccessPolicy.*;
import com.project.platform.runtime.execution.ExecutionService;
import com.project.platform.runtime.model.FlowDefinition.*;
import com.project.platform.runtime.model.WorkflowException;
import java.time.Instant;
import java.util.*;
import org.springframework.transaction.support.TransactionTemplate;

/** Owns load control and terminal measurements, not execution or placement. */
public final class TerminalLoadService {
    private final JdbcTerminalLoadRepository repository;
    private final EdgeAccessService edge;
    private final AccessPolicy access;
    private final TransactionTemplate transactions;
    private final Map<String,Map<String,Profile>> profiles;
    public TerminalLoadService(JdbcTerminalLoadRepository repository,EdgeAccessService edge,AccessPolicy access,
                               TransactionTemplate transactions,Map<String,Map<String,Profile>> profiles) {
        this.repository=repository;this.edge=edge;this.access=access;this.transactions=transactions;this.profiles=profiles;
    }
    public Map<String,Profile> profiles(Actor actor,String ns) {access.require(actor,ns,Action.READ);return profiles.getOrDefault(ns,Map.of());}
    public List<Device> devices(Actor actor,String ns) {access.require(actor,ns,Action.READ);return repository.devices(ns);}
    public List<Run> runs(Actor actor,String ns,int limit,int offset) {
        access.require(actor,ns,Action.READ);ExecutionService.page(limit,offset);return repository.runs(ns,limit,offset);
    }
    public Run start(Actor actor,String ns,Start request) {
        access.require(actor,ns,Action.WRITE);access.require(actor,ns,Action.EXECUTE);
        strategy(request.strategy());
        if(request.terminals()==null || request.terminals().isEmpty() || request.terminals().size()>100 ||
            new HashSet<>(request.terminals()).size()!=request.terminals().size() || !Double.isFinite(request.meanIntervalSeconds()) ||
            request.meanIntervalSeconds()<0.1 || request.meanIntervalSeconds()>3600 || request.inputSize()==null || !Set.of("small","medium","large","mixed").contains(request.inputSize()))
            throw WorkflowException.invalid("load","unique terminals, interval 0.1..3600 seconds and input size required");
        var profile=profiles(actor,ns).get(request.profileId());
        if(profile==null)throw WorkflowException.invalid("profileId","configured task profile required");
        return transactions.execute(tx->{
            var available=new HashMap<String,Device>();repository.devices(ns).forEach(d->available.put(d.terminal().id(),d));
            var clusters=new HashSet<String>();
            for(String id:request.terminals().stream().sorted().toList()) {
                var device=available.get(id);
                if(device==null || !device.terminal().enabled() || device.sampledAt()==null || device.sampledAt().isBefore(Instant.now().minusSeconds(15)))
                    throw WorkflowException.invalid("terminals","terminal is not reporting resources: "+id);
                if(repository.assignment(ns,id,true)!=null)throw WorkflowException.conflict("terminal already belongs to a load run: "+id);
                clusters.add(edge.gateways(actor,ns,100,0).stream().filter(g->g.id().equals(device.terminal().gatewayId()) && g.enabled()).findFirst()
                    .orElseThrow(()->WorkflowException.invalid("gateway","enabled gateway required")).clusterId());
            }
            var pinned=new LinkedHashMap<String,PinnedPair>();
            for(String cluster:clusters) {
                var pair=profile.policies().get(cluster);
                if(pair==null)throw WorkflowException.invalid("profileId","task profile is not configured for "+cluster);
                var local=edge.policy(actor,ns,pair.local());var dqn=edge.policy(actor,ns,pair.dqn());
                var a=validatePolicy(local,cluster,false);var b=validatePolicy(dqn,cluster,true);
                if(!a.applicationId().equals(b.applicationId()) || !a.version().equals(b.version()) || !a.command().equals(b.command()) ||
                    !a.parameters().equals(b.parameters()) || !a.inputFiles().equals(b.inputFiles()) || !a.outputFiles().equals(b.outputFiles()))
                    throw WorkflowException.invalid("profile","both strategies must execute the same application and inputs");
                pinned.put(cluster,new PinnedPair(new PinnedPolicy(pair.local(),local.flow().revision()),new PinnedPolicy(pair.dqn(),dqn.flow().revision())));
            }
            String id=UUID.randomUUID().toString();var now=Instant.now();
            var config=new Config(request.profileId(),profile.label(),List.copyOf(request.terminals()),request.meanIntervalSeconds(),request.seed(),request.inputSize(),pinned);
            repository.create(ns,id,config,request.strategy(),now);
            request.terminals().forEach(t->repository.assign(ns,t,id));
            return repository.run(ns,id,false);
        });
    }
    private Container validatePolicy(EdgeAccess.PolicyView view,String cluster,boolean dqn) {
        var flow=view.flow().definition();
        if(!view.policy().enabled() || !cluster.equals(view.policy().clusterId()) || flow.allTasks().size()!=1 || !flow.outputs().containsKey("terminal_result"))
            throw WorkflowException.invalid("profile","enabled single-task terminal result policy required");
        var task=flow.allTasks().getFirst();var c=task.container();
        if(c==null || task.retry()!=null || c.execution()!=ContainerExecution.TERMINAL || c.offload()==null ||
            (dqn?c.offload().strategy()!=OffloadStrategy.DQN || c.offload().modelVersion()==null ||
                  c.offload().exploration()!=null && c.offload().exploration()!=0:
                  c.offload().strategy()!=OffloadStrategy.FIXED || c.offload().layer()!=OffloadLayer.TERMINAL))
            throw WorkflowException.invalid("profile","FIXED TERMINAL / deterministic DQN without retry required");
        return c;
    }
    public Run switchStrategy(Actor actor,String ns,String id,String strategy) {
        access.require(actor,ns,Action.EXECUTE);strategy(strategy);
        return transactions.execute(tx->{
            var run=repository.run(ns,id,true);
            if(!run.sending())throw WorkflowException.conflict("load run already stopped");
            var current=repository.phases(ns,id).getLast();
            if(!current.strategy().equals(strategy))repository.switchPhase(ns,run,strategy,Instant.now());
            return repository.run(ns,id,false);
        });
    }
    public Run stop(Actor actor,String ns,String id) {
        access.require(actor,ns,Action.EXECUTE);
        return transactions.execute(tx->{var run=repository.run(ns,id,true);if(run.sending())repository.stop(ns,run,Instant.now());return repository.run(ns,id,false);});
    }
    public Command resource(Actor actor,String ns,String terminal,Resource value) {
        edge.terminalHeartbeat(actor,ns,terminal);
        if(value==null || value.cpuSeconds()!=null && (!Double.isFinite(value.cpuSeconds()) || value.cpuSeconds()<0) ||
            !Double.isFinite(value.sampleSeconds()) || value.sampleSeconds()<=0 || !Double.isFinite(value.cpuCores()) || value.cpuCores()<=0 ||
            value.memoryBytes()<0 || value.memoryLimitBytes()<=0 || value.pendingRequests()<0)
            throw WorkflowException.invalid("resource","measured nonnegative usage and positive capacity required");
        return transactions.execute(tx->{
            String id=repository.assignment(ns,terminal,true);Run run=id==null?null:repository.run(ns,id,false);
            repository.resource(ns,terminal,value,Instant.now(),id);
            if(run!=null && !run.sending() && run.id().equals(value.loadRunId()) && !value.sending() && value.pendingRequests()==0 && drained(actor,ns,terminal,run)) {
                repository.assign(ns,terminal,null);run=null;
            }
            return run==null?null:new Command(run.id(),run.sending(),run.config().meanIntervalSeconds(),run.config().seed(),run.config().inputSize());
        });
    }
    private boolean drained(Actor actor,String ns,String terminal,Run run) {
        // A lost client reply or client timeout does not mean the original execution has stopped.
        return repository.requests(ns,run.id(),run.createdAt(),Instant.now()).stream()
            .filter(r->terminal.equals(r.terminalId()) && r.executionId()!=null)
            .allMatch(r->Set.of("SUCCESS","FAILED","KILLED").contains(edge.result(actor,ns,terminal,r.executionId()).state().name()));
    }
    public String compute(Actor actor,String ns,String terminal,Compute request) {
        var gateway=edge.terminalGateway(actor,ns,terminal);uuid(request.runId());uuid(request.requestId());
        return transactions.execute(tx->{
            // Same lock order as the ordinary terminal ingress; phase switches serialize on the run row.
            repository.assignment(ns,terminal,true);
            var run=repository.run(ns,request.runId(),true);member(run,terminal);
            var prior=repository.request(ns,run.id(),terminal,request.requestId());
            if(prior==null && !run.sending())throw WorkflowException.conflict("load sending has stopped");
            var pair=run.config().policies().get(gateway.clusterId());
            var phases=repository.phases(ns,run.id());
            var phase=prior!=null && prior.phase()!=null?phases.stream().filter(p->p.number()==prior.phase()).findFirst().orElseThrow():phases.getLast();
            var policy="LOCAL".equals(phase.strategy())?pair.local():pair.dqn();
            String execution=edge.loadRequest(actor,ns,terminal,request.requestId(),policy.id(),policy.revision(),Map.of("data_file",request.file()));
            if(prior==null)repository.accepted(ns,run.id(),terminal,request.requestId(),phase.number(),execution,Instant.now());
            return execution;
        });
    }
    public void report(Actor actor,String ns,String terminal,Report report) {
        edge.terminalGateway(actor,ns,terminal);uuid(report.runId());uuid(report.requestId());
        if(report.outcome()==null || !Set.of("SUCCESS","FAILED","CANCELLED","TIMEOUT","REJECTED","UNKNOWN").contains(report.outcome()) ||
            !Double.isFinite(report.elapsedSeconds()) || report.elapsedSeconds()<=0 || report.error()!=null && report.error().length()>300)
            throw WorkflowException.invalid("report","valid terminal result and elapsed time required");
        var run=repository.run(ns,report.runId(),false);member(run,terminal);
        var request=repository.request(ns,run.id(),terminal,report.requestId());
        if(Set.of("SUCCESS","FAILED","CANCELLED").contains(report.outcome())) {
            if(request==null || request.executionId()==null)throw WorkflowException.invalid("report","accepted execution required");
            String expected="CANCELLED".equals(report.outcome())?"KILLED":report.outcome();
            if(!edge.result(actor,ns,terminal,request.executionId()).state().name().equals(expected))throw WorkflowException.invalid("report","result differs from execution");
        }
        repository.report(ns,terminal,report,Instant.now());
    }
    public Snapshot snapshot(Actor actor,String ns,String id,Instant from,Instant to) {
        access.require(actor,ns,Action.READ);var run=repository.run(ns,id,false);
        if(from==null)from=run.createdAt();if(to==null)to=Instant.now();
        if(from.isAfter(to))throw WorkflowException.invalid("range","from must not exceed to");
        return new Snapshot(run,repository.phases(ns,id),repository.requests(ns,id,from,to),repository.samples(ns,id,from,to));
    }
    private static void member(Run run,String terminal){if(!run.config().terminals().contains(terminal))throw new AccessPolicy.Forbidden();}
    private static void strategy(String value){if(value==null || !Set.of("LOCAL","DQN").contains(value))throw WorkflowException.invalid("strategy","LOCAL or DQN required");}
    private static void uuid(String value){try{UUID.fromString(value);}catch(RuntimeException e){throw WorkflowException.invalid("id","UUID required");}}
}
