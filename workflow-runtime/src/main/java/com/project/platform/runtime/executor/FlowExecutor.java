package com.project.platform.runtime.executor;

import com.project.platform.runtime.definition.*;
import com.project.platform.runtime.model.*;
import com.project.platform.runtime.model.FlowDefinition.*;
import com.project.platform.runtime.model.ExecutionRecord.TaskRun;
import com.project.platform.runtime.persistence.*;
import com.project.platform.runtime.worker.WorkerJob;
import java.time.*;
import java.util.*;
import static com.project.platform.runtime.model.ExecutionState.*;

/** Sole lifecycle owner. Control tasks are interpreted here; leaves run outside this transaction. */
public final class FlowExecutor {
    private final JdbcExecutionStore store;
    private final JdbcWorkerStore workers;
    private final BindingResolver bindings;
    private final TemplateRenderer renderer;
    private final ExecutionReducer reducer;
    public FlowExecutor(JdbcExecutionStore store,JdbcWorkerStore workers,BindingResolver bindings,TemplateRenderer renderer,ExecutionReducer reducer) {
        this.store=store;this.workers=workers;this.bindings=bindings;this.renderer=renderer;this.reducer=reducer;
    }
    public boolean processNext() {
        return store.transaction(()->{
            var message=store.nextMessage(); if(message==null) return false;
            var execution=store.lock(message.executionId()); store.acknowledge(message.id());
            if(execution.state().terminal()) {new Cycle(execution).after();return true;}
            if(execution.state()==CREATED) {
                store.startExecution(execution.id(),store.now()); store.enqueue(execution.id()); return true;
            }
            new Cycle(execution).run(); return true;
        });
    }
    private final class Cycle {
        private ExecutionRecord execution;
        private final FlowDefinition flow;
        private final Instant now=store.now();
        private final Map<String,TaskRun> runs=new LinkedHashMap<>();
        private String scopeParent;
        private int scopeIteration;
        private Map<String,Map<String,Object>> inheritedOutputs=Map.of();
        private Map<String,Object> item=Map.of();
        Cycle(ExecutionRecord execution) { this.execution=execution;this.flow=execution.definition();refresh(); }
        void refresh() {
            runs.clear();
            for(var run:store.scopedTasks(execution.id(),scopeParent,scopeIteration))runs.put(run.taskId(),run);
        }
        private Map<String,Map<String,Object>> outputs() {
            var output=new LinkedHashMap<>(inheritedOutputs);
            for(var run:runs.values())if(run.state()==SUCCESS) {
                var visible=new LinkedHashMap<>(run.outputs());visible.remove("_loopValues");output.put(run.taskId(),visible);
            }
            return output;
        }
        private <T>T inIteration(TaskRun parent,int iteration,java.util.function.Supplier<T> action) {
            String previousParent=scopeParent;int previousIteration=scopeIteration;var previousOutputs=inheritedOutputs;var previousItem=item;
            var enclosing=outputs();
            if(parent.outputs().containsKey("_loopValues")) {
                var current=new LinkedHashMap<String,Object>();current.put("index",iteration-1);
                current.put("value",((List<?>)parent.outputs().get("_loopValues")).get(iteration-1));item=FlowDefinition.immutable(current);
            } else enclosing.put(parent.taskId(),parent.outputs());
            scopeParent=parent.id();scopeIteration=iteration;inheritedOutputs=enclosing;refresh();
            try{return action.get();}
            finally{scopeParent=previousParent;scopeIteration=previousIteration;inheritedOutputs=previousOutputs;item=previousItem;refresh();}
        }
        void run() {
            if(flow.sla()!=null && execution.startedAt()!=null && execution.slaViolatedAt()==null
                    && !now.isBefore(execution.startedAt().plus(Duration.parse(flow.sla().maxDuration())))) {
                store.slaViolated(execution.id(),now);execution=store.lock(execution.id());
            }
            if(execution.state()==KILLING && execution.mainState()!=KILLED) {
                boolean stopped=true;
                for(var task:flow.tasks())stopped&=stopTree(task);
                for(var task:flow.errors())stopped&=stopTree(task);
                if(!stopped){wake();return;}
                store.mainOutcome(execution.id(),KILLED,execution.error()==null?"cancelled":execution.error());
                execution=store.lock(execution.id());
            }
            if(execution.mainState()==null) {
                var main=group(flow.tasks(),"core.Sequential",false);
                if(!main.state().terminal()) { wake();return; }
                String error=main.error();
                if(main.state()==SUCCESS) {
                    try { bindings.outputs(flow.outputs(),execution.inputs(),execution.variables(),store.successfulOutputs(execution.id())); }
                    catch(WorkflowException ex) { error=ex.getMessage(); }
                }
                store.mainOutcome(execution.id(),error==null?SUCCESS:FAILED,error);
                execution=store.lock(execution.id());
            }
            if(execution.mainState()==FAILED) {
                var errors=group(flow.errors(),"core.Sequential",false);
                if(!errors.state().terminal()) { wake();return; }
            } else flow.errors().forEach(this::skipTree);
            var cleanup=group(flow.finallyTasks(),"core.Sequential",true);
            if(!cleanup.state().terminal()) { wake();return; }
            if(cleanup.error()!=null) store.cleanupError(execution.id(),cleanup.error());
            execution=store.lock(execution.id());
            var outputs=execution.mainState()==SUCCESS
                    ?bindings.outputs(flow.outputs(),execution.inputs(),execution.variables(),store.successfulOutputs(execution.id())):Map.<String,Object>of();
            var result=execution.mainState()==SUCCESS && execution.cleanupError()!=null?FAILED:execution.mainState();
            store.complete(execution.id(),result,outputs,now);
            store.promote(execution.namespace(),execution.flowId());
            if(!flow.afterExecution().isEmpty())store.enqueue(execution.id());
        }
        void after() {
            if(!group(flow.afterExecution(),"core.Sequential",true).state().terminal())wake();
        }
        private void wake() { store.enqueueAt(execution.id(),now.plusMillis(100)); }
        private record Outcome(ExecutionState state,String error) {}
        private Outcome group(List<Task> tasks,String mode,boolean continueAfterFailure) {
            boolean parallel="core.Parallel".equals(mode)||"core.Dag".equals(mode);
            // Merge active tasks before considering new siblings. Once a sibling fails, don't dispatch new ones.
            if(parallel) for(var spec:tasks) if(runs.get(spec.id()).state()==RUNNING || runs.get(spec.id()).state()==RETRYING) tick(spec);
            boolean failed=tasks.stream().anyMatch(t->runs.get(t.id()).state()==FAILED || runs.get(t.id()).state()==KILLED);
            for(var spec:tasks) {
                var run=runs.get(spec.id());
                if(run.state()==CREATED) {
                    if(failed && !continueAfterFailure) { skipTree(spec);continue; }
                    if(reducer.ready(spec,tasks,mode,runs)) tick(spec);
                } else if(!parallel && !run.state().terminal()) tick(spec);
                run=runs.get(spec.id());
                if(run.state()==FAILED || run.state()==KILLED) failed=true;
                if(!parallel && !run.state().terminal()) return new Outcome(RUNNING,null);
            }
            if(tasks.stream().anyMatch(t->!runs.get(t.id()).state().terminal())) return new Outcome(RUNNING,null);
            String error=tasks.stream().map(t->runs.get(t.id())).filter(r->r.state()==FAILED||r.state()==KILLED)
                    .map(r->r.error()==null?"child task failed":r.error()).findFirst().orElse(null);
            return new Outcome(error==null?SUCCESS:FAILED,error);
        }
        private void tick(Task spec) {
            var run=runs.get(spec.id()); if(run.state().terminal()) return;
            if(!spec.control()) { leaf(spec,run);return; }
            if(spec.repeat()!=null){repeat(spec,run);return;}
            if(spec.loop()!=null){loop(spec,run);return;}
            if(run.state()==CREATED) {
                Map<String,Object> output=Map.of();
                if("core.If".equals(spec.type())) {
                    try {
                        String rendered=renderer.render(spec.condition(),context(run,0)).trim();
                        if(!"true".equals(rendered)&&!"false".equals(rendered)) throw WorkflowException.invalid("condition","expected true or false");
                        output=Map.of("evaluationResult",Boolean.valueOf(rendered));
                    } catch(WorkflowException ex) {
                        store.controlState(run,FAILED,Map.of(),ex.getMessage(),now);
                        spec.thenTasks().forEach(this::skipTree);spec.elseTasks().forEach(this::skipTree);refresh();return;
                    }
                }
                store.controlState(run,RUNNING,output,null,now);refresh();run=runs.get(spec.id());
            }
            List<Task> children=spec.tasks(); String mode=spec.type();
            if("core.If".equals(mode)) {
                boolean branch=Boolean.TRUE.equals(run.outputs().get("evaluationResult"));
                children=branch?spec.thenTasks():spec.elseTasks();
                (branch?spec.elseTasks():spec.thenTasks()).forEach(this::skipTree);mode="core.Sequential";
            }
            var result=group(children,mode,false);
            if(result.state().terminal()) { store.controlState(run,result.state(),run.outputs(),result.error(),now);refresh(); }
        }
        private void repeat(Task spec,TaskRun run) {
            try {
                if(run.state()==CREATED) {
                    Object count=bindings.resolve(spec.repeat().iterations(),execution.inputs(),execution.variables(),outputs());
                    BindingResolver.validateType("repeat.iterations",InputType.INTEGER,count);
                    if(!(count instanceof Number number) || !number.toString().matches("[1-9][0-9]?|100"))
                        throw WorkflowException.invalid("repeat.iterations","integer 1..100 required");
                    var initial=bindings.outputs(spec.repeat().initial(),execution.inputs(),execution.variables(),outputs());
                    initial.put("iterations",number.intValue());initial.put("iterationCount",0);
                    store.controlState(run,RUNNING,initial,null,now);refresh();run=runs.get(spec.id());
                }
                int completed=((Number)run.outputs().get("iterationCount")).intValue();
                int limit=((Number)run.outputs().get("iterations")).intValue();
                store.createIteration(run,completed+1,spec.tasks());
                var parent=run;
                inIteration(parent,completed+1,()->{
                    var result=group(spec.tasks(),"core.Sequential",false);
                    if(result.state().terminal()) {
                        if(result.state()!=SUCCESS)store.controlState(parent,FAILED,parent.outputs(),result.error(),now);
                        else {
                            var next=bindings.outputs(spec.repeat().feedback(),execution.inputs(),execution.variables(),outputs());
                            next.put("iterations",limit);next.put("iterationCount",completed+1);
                            store.controlState(parent,completed+1==limit?SUCCESS:RUNNING,next,null,now);
                        }
                    }
                    return null;
                });
            } catch(WorkflowException ex) {
                store.controlState(run,FAILED,run.outputs(),ex.getMessage(),now);refresh();
            }
        }
        private void loop(Task spec,TaskRun run) {
            try {
                if(run.state()==CREATED) {
                    var values=FlowValidator.loopValues(bindings.resolve(spec.loop().values(),execution.inputs(),execution.variables(),outputs(),item));
                    store.controlState(run,RUNNING,Map.of("_loopValues",values),null,now);refresh();run=runs.get(spec.id());
                }
                var parent=run;var values=(List<?>)parent.outputs().get("_loopValues");
                var iterations=store.iterations(parent.id());
                int active=0;String error=null;
                for(int iteration:iterations) {
                    var result=inIteration(parent,iteration,()->loopItem(spec));
                    if(!result.state().terminal())active++;
                    if(result.error()!=null && error==null)error=result.error();
                }
                int admitted=iterations.size();
                while(error==null && active<spec.loop().concurrency() && admitted<values.size()) {
                    int iteration=++admitted;store.createIteration(parent,iteration,spec.tasks());
                    var result=inIteration(parent,iteration,()->loopItem(spec));
                    if(!result.state().terminal())active++;
                    if(result.error()!=null)error=result.error();
                }
                if(active>0)return;
                if(error!=null) {store.controlState(parent,FAILED,parent.outputs(),error,now);refresh();return;}
                if(admitted==values.size()) {
                    var collected=new LinkedHashMap<String,Object>();
                    spec.loop().outputs().keySet().forEach(name->collected.put(name,new ArrayList<Object>()));
                    for(int iteration=1;iteration<=admitted;iteration++) {
                        var result=inIteration(parent,iteration,()->bindings.outputs(spec.loop().outputs(),execution.inputs(),execution.variables(),outputs(),item));
                        result.forEach((name,value)->{ @SuppressWarnings("unchecked") var list=(List<Object>)collected.get(name);list.add(value); });
                    }
                    // Keep the single snapshot for history, but never expose it through Binding or child context.
                    collected.put("_loopValues",values);store.controlState(parent,SUCCESS,collected,null,now);refresh();
                }
            } catch(WorkflowException ex) {store.controlState(run,FAILED,run.outputs(),ex.getMessage(),now);refresh();}
        }
        private Outcome loopItem(Task spec) {
            var result=group(spec.tasks(),"core.Sequential",false);
            // Stop admission as soon as a leaf has exhausted its retries, even while its peers drain.
            String failure=runs.values().stream().filter(r->r.state()==FAILED || r.state()==KILLED)
                    .map(r->r.error()==null?"loop item failed":r.error()).findFirst().orElse(result.error());
            return new Outcome(result.state(),failure);
        }
        private void leaf(Task spec,TaskRun run) {
            var attempts=store.attempts(run.id());
            if(run.state()==CREATED || run.state()==RETRYING) {
                if(run.retryAt()!=null && run.retryAt().isAfter(now)) return;
                int attempt=attempts.isEmpty()?1:attempts.getLast().attemptNo()+1;
                store.startTask(run,attempt,now);
                workers.dispatch(new WorkerJob(execution.id(),run.id(),attempt,spec,context(run,attempt)),spec.timeout()==null?null:now.plus(Duration.parse(spec.timeout())));
                refresh();return;
            }
            var attempt=attempts.getLast();
            var result=workers.result(run.id(),attempt.attemptNo());
            if(result==null && spec.timeout()!=null && !now.isBefore(attempt.startedAt().plus(Duration.parse(spec.timeout())))) {
                if(spec.container()!=null)workers.cancel(run.id(),attempt.attemptNo(),"attempt timed out");
                else result=WorkerJob.Result.failed("attempt timed out");
            }
            if(result==null) return;
            workers.remove(run.id(),attempt.attemptNo());
            store.finishAttempt(run,attempt.attemptNo(),result.success()?SUCCESS:FAILED,result.outputs(),result.error(),now);
            if(!result.success()||"core.Log".equals(spec.type())) store.log(execution.id(),run.id(),attempt.attemptNo(),result.success()?"INFO":"ERROR",result.success()?(String)result.outputs().get("message"):result.error(),now);
            Instant retry=result.success()?null:reducer.retryAt(spec,attempt.attemptNo(),now);
            if(retry!=null) store.retry(run,retry);
            refresh();
        }
        private Map<String,Object> context(TaskRun run,int attempt) {
            var details=new LinkedHashMap<String,Object>();
            details.put("id",execution.id());details.put("namespace",execution.namespace());details.put("submittedBy",execution.submittedBy());
            details.put("state",execution.state().name());details.put("outputs",execution.outputs());details.put("error",execution.error());
            details.put("slaViolated",execution.slaViolatedAt()!=null);
            var context=new LinkedHashMap<String,Object>(Map.of("inputs",execution.inputs(),"vars",execution.variables(),"outputs",outputs(),
                    "execution",details,"taskrun",Map.of("id",run.id(),"attemptsCount",attempt,"iteration",run.iteration())));
            if(!item.isEmpty())context.put("item",item);
            return context;
        }
        private void skipTree(Task spec) {
            var run=runs.get(spec.id());
            if(run==null)return; // Future Repeat iterations have no TaskRun yet.
            if(run.state()==CREATED) store.skip(execution.id(),run.taskIndex(),run.taskIndex()+1,now);
            if(!spec.dynamic())spec.tasks().forEach(this::skipTree);
            spec.thenTasks().forEach(this::skipTree);spec.elseTasks().forEach(this::skipTree);refresh();
        }
        private boolean stopTree(Task spec) {
            var run=runs.get(spec.id());
            if(run==null)return true;
            if(spec.dynamic() && run.state()==RUNNING) {
                boolean stopped=true;
                for(int iteration:store.iterations(run.id()))stopped&=inIteration(run,iteration,()->{
                    boolean value=true;for(var child:spec.tasks())value&=stopTree(child);return value;
                });
                if(!stopped)return false;
            }
            if(run.state()==RUNNING||run.state()==RETRYING) {
                var attempts=store.attempts(run.id());
                if(spec.container()!=null && run.state()==RUNNING && !attempts.isEmpty()) {
                    int attempt=attempts.getLast().attemptNo();
                    workers.cancel(run.id(),attempt,"cancelled");
                    if(workers.result(run.id(),attempt)==null)return false;
                }
                if(!attempts.isEmpty()) workers.remove(run.id(),attempts.getLast().attemptNo());
                store.killTask(run,now);
            } else if(run.state()==CREATED) skipTree(spec);
            boolean stopped=true;
            if(!spec.dynamic())for(var child:spec.tasks())stopped&=stopTree(child);
            for(var child:spec.thenTasks())stopped&=stopTree(child);
            for(var child:spec.elseTasks())stopped&=stopTree(child);
            refresh();return stopped;
        }
    }
}
