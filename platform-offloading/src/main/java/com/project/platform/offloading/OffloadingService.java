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
                         Instant createdAt,Instant startedAt,Instant finishedAt,String outcome,Double reward,Measurement measurement,Double inferenceMs) {}
    public record Measurement(String edge,String terminal,String flowId,Double[] inputs,List<Integer> legalActions,String unavailable,
                              String nextKey,double[] nextState,List<Integer> nextLegalActions,Double elapsedSeconds,double limitSeconds,
                              String feedbackOutcome,boolean trainable) {}
    public record Feedback(String outcome,Double elapsedSeconds) {}
    public static final double FEEDBACK_LIMIT_SECONDS=120;
    private final JdbcOffloadingRepository repository;private final AccessPolicy access;
    public OffloadingService(JdbcOffloadingRepository repository,AccessPolicy access){this.repository=repository;this.access=access;}
    public Sample get(String ns,String key){return repository.get(ns,key);}
    public Sample decide(Actor actor,String ns,String key,String execution,Workload work,List<Candidate> candidates,String strategy,String modelVersion) {
        return decide(actor,ns,key,execution,work,candidates,strategy,modelVersion,null);
    }
    public Sample decide(Actor actor,String ns,String key,String execution,Workload work,List<Candidate> candidates,String strategy,String modelVersion,Layer fixed) {
        access.require(actor,ns,Action.EXECUTE);
        if(!Set.of("RULE","FIXED").contains(strategy) || modelVersion!=null || ("FIXED".equals(strategy)!=(fixed!=null)))
            throw WorkflowException.invalid("offload","RULE/FIXED layer selection required here; DQN requires a complete measured edge decision");
        var existing=repository.get(ns,key);if(existing!=null)return existing;
        var layers=new EnumMap<Layer,Candidate>(Layer.class);
        for(var c:candidates) {
            if(c.layer()==null || c.capacity()<1 || c.active()<0 || c.waiting()<0 || layers.putIfAbsent(c.layer(),c)!=null)
                throw WorkflowException.invalid("offload","one nonnegative aggregate load per legal layer required");
        }
        Layer selected=null;double best=Double.POSITIVE_INFINITY;
        for(var c:layers.values()) {
            if(fixed!=null && c.layer()!=fixed)continue;
            double score=((double)c.active()+c.waiting())/c.capacity();
            if(selected==null || score<best){selected=c.layer();best=score;}
        }
        if(selected==null)throw WorkflowException.invalid("offload","no healthy configured layer satisfies dataset locality");
        // No cluster identifier or 13-dimensional legacy state is manufactured at the layer boundary.
        return repository.begin(ns,key,execution,work,new Target(selected.name(),null),strategy,null,null,selected.ordinal(),null);
    }
    /** Persist the authenticated gateway's layer action; concrete placement belongs to Resource. */
    public Sample edgeDecision(Actor actor,String ns,String key,String execution,Workload work,String modelVersion,List<Integer> legal,int action,double inferenceMs) {
        access.require(actor,ns,Action.EXECUTE);version(modelVersion);
        if(action<0 || action>2 || !legal.contains(action))throw WorkflowException.invalid("offload","edge returned an illegal layer");
        if(!Double.isFinite(inferenceMs) || inferenceMs<0)throw WorkflowException.invalid("inferenceMs","nonnegative measured inference time required");
        var existing=repository.get(ns,key);if(existing!=null)return existing;
        return repository.begin(ns,key,execution,work,new Target(Layer.values()[action].name(),null),"DQN",modelVersion,null,action,inferenceMs);
    }
    /** Record the position already allocated by Resource; never select or reserve it here. */
    public void placed(Actor actor,String ns,String key,Target actual) {
        access.require(actor,ns,Action.EXECUTE);
        if(actual==null || actual.id()==null || actual.id().isBlank())throw WorkflowException.invalid("target","allocated position required");
        repository.placed(ns,key,actual);
    }
    public void started(Actor actor,String ns,String key,long inputBytes){access.require(actor,ns,Action.EXECUTE);repository.started(ns,key,inputBytes);}
    /** Called inside the same Resource admission transaction; fixes the actual next decision, never completion order. */
    public Sample capture(String ns,String key,String edge,String terminal,String flowId,Double[] inputs,List<Integer> legal,String unavailable) {
        if(legal.isEmpty())throw WorkflowException.invalid("measurement","legal actions required");
        double[] state=normalize(inputs,unavailable);
        return repository.capture(ns,key,edge,terminal,flowId,inputs,legal,unavailable,state,FEEDBACK_LIMIT_SECONDS);
    }
    public static double[] normalize(Double[] inputs,String unavailable) {
        if(inputs.length!=6)throw WorkflowException.invalid("measurement","six values required");
        for(Double value:inputs)if(value!=null && (!Double.isFinite(value) || value<0))throw WorkflowException.invalid("measurement","finite nonnegative values required");
        double[] state=Arrays.stream(inputs).anyMatch(Objects::isNull)?null:Arrays.stream(inputs).mapToDouble(Math::log1p).toArray();
        if(unavailable!=null)state=null;
        return state;
    }
    /** The ingress caller has already checked original terminal ownership and actual Execution outcome. */
    public void feedback(String ns,String execution,String terminal,Feedback feedback) {
        if(feedback==null || feedback.outcome()==null || !Set.of("SUCCESS","FAILED","TIMEOUT","CANCELLED","UNMEASURED").contains(feedback.outcome()))
            throw WorkflowException.invalid("feedback","valid outcome required");
        Double elapsed=feedback.elapsedSeconds();
        if("UNMEASURED".equals(feedback.outcome()) ? elapsed!=null : elapsed==null || !Double.isFinite(elapsed) || elapsed<=0 || elapsed>86400)
            throw WorkflowException.invalid("elapsedSeconds","positive monotonic elapsed required; UNMEASURED requires null");
        if("TIMEOUT".equals(feedback.outcome()) && elapsed<FEEDBACK_LIMIT_SECONDS)throw WorkflowException.invalid("elapsedSeconds","deadline has not elapsed");
        String outcome="SUCCESS".equals(feedback.outcome()) && elapsed>FEEDBACK_LIMIT_SECONDS?"TIMEOUT":feedback.outcome();
        Double reward=switch(outcome) {case "SUCCESS"->-elapsed/FEEDBACK_LIMIT_SECONDS;case "FAILED","TIMEOUT"->-2.0;default->null;};
        repository.feedback(ns,execution,terminal,outcome,elapsed,reward);
    }
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
