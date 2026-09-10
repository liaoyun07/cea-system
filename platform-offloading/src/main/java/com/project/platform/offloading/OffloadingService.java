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
    public record Candidate(Target target,int capacity,int active,int waiting) {}
    public record Sample(String key,String executionId,String applicationId,String applicationVersion,Map<String,Object> workload,long inputBytes,
                         Target target,String strategy,String modelVersion,double[] state,Integer action,
                         Instant createdAt,Instant startedAt,Instant finishedAt,String outcome,Double reward) {}
    private record Scored(Candidate candidate,Double estimate,double score) {}
    private final JdbcOffloadingRepository repository;private final AccessPolicy access;
    public OffloadingService(JdbcOffloadingRepository repository,AccessPolicy access){this.repository=repository;this.access=access;}
    public Sample get(String ns,String key){return repository.get(ns,key);}
    public Sample decide(Actor actor,String ns,String key,String execution,Workload work,List<Candidate> candidates,String strategy,String modelVersion) {
        access.require(actor,ns,Action.EXECUTE);var existing=repository.get(ns,key);if(existing!=null)return existing;
        if(!Set.of("RULE","DQN").contains(strategy))throw WorkflowException.invalid("offload","RULE or DQN required");
        Scored[] best=new Scored[3];
        for(var c:candidates) {
            int a=action(c.target().kind());Double estimate=estimate(actor,ns,work,c.target());
            double load=(c.active()+c.waiting())/(double)c.capacity();
            // Unknown cost has no fabricated milliseconds; only a load-based cold-start ordering.
            double score=estimate==null?load:Math.log1p(estimate/1000.0)+load;
            var scored=new Scored(c,estimate,score);
            if(best[a]==null || score<best[a].score() || (score==best[a].score() && c.target().id().compareTo(best[a].candidate().target().id())<0))best[a]=scored;
        }
        double[] state=new double[DqnModel.FEATURES];state[0]=Math.min(1,Math.log1p(work.inputBytes())/Math.log1p(1L<<40));
        for(int a=0;a<3;a++)if(best[a]!=null) {
            var b=best[a];int i=1+a*4;state[i]=1;
            state[i+1]=Math.min(1,(b.candidate().active()+b.candidate().waiting())/(double)(b.candidate().capacity()*4));
            state[i+2]=b.estimate()==null?0:Math.min(1,Math.log1p(b.estimate()/1000.0)/Math.log1p(3600));state[i+3]=b.estimate()==null?0:1;
        }
        int selected=-1;
        if("DQN".equals(strategy))selected=repository.model(ns,modelVersion).choose(state);
        else for(int a=0;a<3;a++)if(best[a]!=null && (selected<0 || best[a].score()<best[selected].score()))selected=a;
        if(selected<0)throw WorkflowException.invalid("offload","no healthy configured target satisfies dataset locality");
        return repository.begin(ns,key,execution,work,best[selected].candidate().target(),strategy,modelVersion,state,selected);
    }
    public void started(Actor actor,String ns,String key,long inputBytes){access.require(actor,ns,Action.EXECUTE);repository.started(ns,key,inputBytes);}
    /** Internal worker feedback, not an HTTP write endpoint. */
    public void finish(String ns,String key,String outcome) {
        if(!Set.of("SUCCESS","FAILED","CANCELLED").contains(outcome))throw WorkflowException.invalid("outcome","invalid observation outcome");repository.finish(ns,key,outcome);
    }
    public Double estimate(Actor actor,String ns,Workload work,Target target){access.require(actor,ns,Action.EXECUTE);return repository.estimate(ns,work,target);}
    public List<Sample> samples(Actor actor,String ns,int limit,int offset){access.require(actor,ns,Action.READ);ExecutionService.page(limit,offset);return repository.list(ns,limit,offset);}
    public DqnModel register(Actor actor,String ns,String version,DqnModel model) {
        access.require(actor,ns,Action.WRITE);version(version);if(model==null)throw WorkflowException.invalid("model","required");model.validate();return repository.register(ns,version,model);
    }
    public DqnModel model(Actor actor,String ns,String version){access.require(actor,ns,Action.READ);version(version);return repository.model(ns,version);}
    private static void version(String version){if(version==null || !version.matches("[A-Za-z0-9][A-Za-z0-9_.-]{0,99}"))throw WorkflowException.invalid("modelVersion","invalid version");}
    private static int action(String kind){return switch(kind){case "TERMINAL"->0;case "EDGE"->1;case "CLOUD"->2;default->throw WorkflowException.invalid("target","unknown kind");};}
}
