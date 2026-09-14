package com.project.platform.offloading;

import com.project.platform.foundation.identity.AccessPolicy;
import com.project.platform.foundation.identity.AccessPolicy.*;
import com.project.platform.runtime.execution.ExecutionService;
import com.project.platform.runtime.model.WorkflowException;
import java.time.Instant;
import java.util.*;

/** Chooses and observes explicitly offloadable terminal tasks only. */
public final class OffloadingService {
    public record Target(String kind,String id) {}
    public record Workload(String applicationId,String version,List<String> command,Map<String,Object> parameters,long inputBytes) {}
    public enum Layer { TERMINAL, EDGE, CLOUD }
    public record Candidate(Layer layer,int capacity,int active,int waiting) {}
    public record Sample(String key,String executionId,String applicationId,String applicationVersion,Map<String,Object> workload,long inputBytes,
                         Target target,String strategy,String modelVersion,double[] state,Integer action,
                         Instant createdAt,Instant startedAt,Instant finishedAt,String outcome,Double reward) {}
    private final JdbcOffloadingRepository repository;private final AccessPolicy access;
    public OffloadingService(JdbcOffloadingRepository repository,AccessPolicy access){this.repository=repository;this.access=access;}
    public Sample get(String ns,String key){return repository.get(ns,key);}
    public Sample decide(Actor actor,String ns,String key,String execution,Workload work,List<Candidate> candidates,String strategy,String modelVersion) {
        access.require(actor,ns,Action.EXECUTE);
        if(!"RULE".equals(strategy) || modelVersion!=null)throw WorkflowException.invalid("offload","only RULE is enabled; Double DQN integration is pending");
        var existing=repository.get(ns,key);if(existing!=null)return existing;
        var layers=new EnumMap<Layer,Candidate>(Layer.class);
        for(var c:candidates) {
            if(c.layer()==null || c.capacity()<1 || c.active()<0 || c.waiting()<0 || layers.putIfAbsent(c.layer(),c)!=null)
                throw WorkflowException.invalid("offload","one nonnegative aggregate load per legal layer required");
        }
        Layer selected=null;double best=Double.POSITIVE_INFINITY;
        for(var c:layers.values()) {
            double score=((double)c.active()+c.waiting())/c.capacity();
            if(selected==null || score<best){selected=c.layer();best=score;}
        }
        if(selected==null)throw WorkflowException.invalid("offload","no healthy configured layer satisfies dataset locality");
        // No cluster identifier or 13-dimensional legacy state is manufactured at the layer boundary.
        return repository.begin(ns,key,execution,work,new Target(selected.name(),null),strategy,null,null,selected.ordinal());
    }
    /** Record the position already allocated by Resource; never select or reserve it here. */
    public void placed(Actor actor,String ns,String key,Target actual) {
        access.require(actor,ns,Action.EXECUTE);
        if(actual==null || actual.id()==null || actual.id().isBlank())throw WorkflowException.invalid("target","allocated position required");
        repository.placed(ns,key,actual);
    }
    public void started(Actor actor,String ns,String key,long inputBytes){access.require(actor,ns,Action.EXECUTE);repository.started(ns,key,inputBytes);}
    /** Internal worker feedback, not an HTTP write endpoint. */
    public void finish(String ns,String key,String outcome) {
        if(!Set.of("SUCCESS","FAILED","CANCELLED").contains(outcome))throw WorkflowException.invalid("outcome","invalid observation outcome");repository.finish(ns,key,outcome);
    }
    public List<Sample> samples(Actor actor,String ns,int limit,int offset){access.require(actor,ns,Action.READ);ExecutionService.page(limit,offset);return repository.list(ns,limit,offset);}
    public DqnModel register(Actor actor,String ns,String version,DqnModel model) {
        access.require(actor,ns,Action.WRITE);version(version);if(model==null)throw WorkflowException.invalid("model","required");model.validate();return repository.register(ns,version,model);
    }
    public DqnModel model(Actor actor,String ns,String version){access.require(actor,ns,Action.READ);version(version);return repository.model(ns,version);}
    private static void version(String version){if(version==null || !version.matches("[A-Za-z0-9][A-Za-z0-9_.-]{0,99}"))throw WorkflowException.invalid("modelVersion","invalid version");}
}
