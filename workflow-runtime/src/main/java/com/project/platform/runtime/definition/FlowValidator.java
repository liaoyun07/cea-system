package com.project.platform.runtime.definition;

import com.project.platform.runtime.model.FlowDefinition;
import com.project.platform.runtime.model.FlowDefinition.*;
import com.project.platform.runtime.model.WorkflowException;
import java.util.HashSet;
import java.util.Set;
import java.util.List;
import java.util.ArrayList;
import com.project.platform.runtime.scheduler.ScheduleCalculator;

public final class FlowValidator {
    private final TemplateRenderer renderer;
    public FlowValidator(TemplateRenderer renderer) { this.renderer = renderer; }

    public static void identifier(String value, String path) {
        if (value == null || !value.matches("[A-Za-z][A-Za-z0-9_.-]{0,99}")) {
            throw WorkflowException.invalid(path, "expected a letter followed by up to 99 letters/digits/._-");
        }
    }
    public void validate(FlowDefinition flow) {
        if (flow == null) throw WorkflowException.invalid("source", "Flow object required");
        if (flow.schemaVersion() != 1) throw WorkflowException.invalid("schemaVersion", "only 1 is supported");
        identifier(flow.id(), "id");
        identifier(flow.namespace(), "namespace");
        validateGroup(flow.tasks(),false,0); validateGroup(flow.errors(),false,0); validateGroup(flow.finallyTasks(),false,0);
        if (flow.tasks().isEmpty() || flow.allTasks().size() > 100) {
            throw WorkflowException.invalid("tasks", "requires 1..100 tasks");
        }
        flow.inputs().forEach((name, input) -> {
            identifier(name, "inputs");
            if (input == null) throw WorkflowException.invalid("inputs." + name, "definition required");
            BindingResolver.validateType(name, input.type(), input.defaultValue());
        });
        if(flow.concurrency()!=null && (flow.concurrency().limit()==null || flow.concurrency().limit()<1 || flow.concurrency().limit()>1000))
            throw WorkflowException.invalid("concurrency.limit","1..1000 required");
        if(flow.schedule()!=null) {
            ScheduleCalculator.validate(flow.schedule());
        }
        Set<String> taskIds = new HashSet<>();
        for (Task task : flow.allTasks()) {
            identifier(task.id(), "tasks.id");
            if (!taskIds.add(task.id())) throw WorkflowException.invalid("tasks.id", "duplicate " + task.id());
            if ("core.Log".equals(task.type())) {
                renderer.validate(task.message());
                if (task.duration()!=null) throw WorkflowException.invalid("duration", "only Sleep supports duration");
            } else if ("core.Sleep".equals(task.type())) {
                duration(task.duration(), "duration");
                if (task.message()!=null) throw WorkflowException.invalid("message", "only Log supports message");
            } else if("core.Http".equals(task.type()) || "core.Sql".equals(task.type())) {
                if(task.timeout()==null || task.message()!=null || task.duration()!=null)throw WorkflowException.invalid("tasks","Http/Sql require timeout and forbid message/duration");
                if("core.Http".equals(task.type())) {
                    var h=task.http();if(h==null || h.method()==null || !Set.of("GET","POST").contains(h.method()))throw WorkflowException.invalid("http","GET or POST required");
                    identifier(h.connection(),"http.connection");
                    if("GET".equals(h.method()) && h.body()!=null)throw WorkflowException.invalid("http.body","GET has no body");
                    if("POST".equals(h.method()) && task.retry()!=null)throw WorkflowException.invalid("retry","POST cannot automatically retry an unknown external result");
                } else {
                    var s=task.sql();if(s==null || s.query()==null || !s.query().stripLeading().toUpperCase(java.util.Locale.ROOT).startsWith("SELECT ") || s.query().contains(";") || s.query().length()>65536 || s.parameters().size()>100)
                        throw WorkflowException.invalid("sql","single parameterized SELECT required");
                    identifier(s.connection(),"sql.connection");
                }
            } else if("platform.Application".equals(task.type())) {
                var c=task.container();
                if(c==null || task.timeout()==null || task.message()!=null || task.duration()!=null)
                    throw WorkflowException.invalid("container","Application requires container/timeout and forbids message/duration");
                identifier(c.applicationId(),"applicationId");
                if(c.version()==null || !c.version().matches("[A-Za-z0-9][A-Za-z0-9_.-]{0,99}"))throw WorkflowException.invalid("version","version token required");
                if(c.candidateClusters().isEmpty() || c.candidateClusters().size()>100 || c.command().isEmpty() || c.command().size()>100
                        || c.parameters().size()>100 || c.inputFiles().size()>30 || c.outputFiles().size()>30)
                    throw WorkflowException.invalid("container","invalid command, candidates or file/parameter count");
                c.candidateClusters().forEach(id->identifier(id,"candidateClusters"));
                if(new HashSet<>(c.candidateClusters()).size()!=c.candidateClusters().size() || new HashSet<>(c.outputFiles()).size()!=c.outputFiles().size())
                    throw WorkflowException.invalid("container","duplicate candidate/output");
                for(String arg:c.command())if(arg==null || arg.length()>8192)throw WorkflowException.invalid("command","argument too large or null");
                c.inputFiles().keySet().forEach(this::fileName);c.outputFiles().forEach(this::fileName);
            } else if(task.control()) {
                if(task.message()!=null || task.duration()!=null || task.retry()!=null || task.timeout()!=null)
                    throw WorkflowException.invalid("tasks."+task.id(),"control tasks cannot have message/duration/retry/timeout");
                if("core.If".equals(task.type())) renderer.validate(task.condition());
                if("core.Repeat".equals(task.type())) {
                    var repeat=task.repeat();
                    if(repeat==null || !repeat.initial().keySet().equals(repeat.feedback().keySet()) || repeat.initial().size()>30)
                        throw WorkflowException.invalid("repeat","initial/feedback must declare the same state keys (at most 30)");
                    repeat.initial().keySet().forEach(name->{identifier(name,"repeat.initial");if(Set.of("iterations","iterationCount").contains(name))throw WorkflowException.invalid("repeat","reserved output name");});
                    var children=new ArrayList<Task>();FlowDefinition.flatten(task.tasks(),children);
                    if(children.stream().anyMatch(child->"core.Repeat".equals(child.type())))throw WorkflowException.invalid("repeat","nested Repeat is not supported");
                }
            } else throw WorkflowException.invalid("tasks." + task.id(), "unsupported task type");
            if(!"platform.Application".equals(task.type()) && task.container()!=null)throw WorkflowException.invalid("container","only Application supports container");
            if(!"core.Http".equals(task.type()) && task.http()!=null)throw WorkflowException.invalid("http","only Http supports http");
            if(!"core.Sql".equals(task.type()) && task.sql()!=null)throw WorkflowException.invalid("sql","only Sql supports sql");
            if(!"core.Repeat".equals(task.type()) && task.repeat()!=null)throw WorkflowException.invalid("repeat","only Repeat supports repeat");
            if (task.timeout()!=null) duration(task.timeout(), "timeout");
            if (task.retry()!=null) {
                var retry=task.retry();
                if (!"constant".equals(retry.type()) || retry.maxAttempts()==null || retry.maxAttempts()<1 || retry.maxAttempts()>100)
                    throw WorkflowException.invalid("retry", "constant with maxAttempts 1..100 required");
                duration(retry.interval(), "retry.interval");
            }
        }
        flow.variables().forEach((name, binding) -> {
            identifier(name, "variables");
            validateBinding(binding, flow, Set.of(), "variables." + name);
        });
        // Structural DFS catches cycles even when required inputs have no values at save time.
        for (String variable : flow.variables().keySet()) visitVariable(variable, flow, new HashSet<>(), new HashSet<>());
        validateTaskBindings(flow,flow.tasks(),"core.Sequential",Set.of());
        var mainBindings=new HashSet<String>();flow.tasks().forEach(t->completed(t,mainBindings));
        validateTaskBindings(flow,flow.errors(),"core.Sequential",mainBindings);
        var cleanupBindings=new HashSet<>(mainBindings);flow.errors().forEach(t->completed(t,cleanupBindings));
        validateTaskBindings(flow,flow.finallyTasks(),"core.Sequential",cleanupBindings);
        flow.outputs().forEach((name, binding) -> {
            identifier(name, "outputs");
            var main=new ArrayList<Task>(); FlowDefinition.flatten(flow.tasks(),main);
            var visible=main.stream().map(Task::id).collect(java.util.stream.Collectors.toSet());
            for(var task:main)if(task.repeat()!=null){var children=new ArrayList<Task>();FlowDefinition.flatten(task.tasks(),children);children.forEach(child->visible.remove(child.id()));}
            validateBinding(binding, flow, visible, "outputs." + name);
        });
        if(flow.schedule()!=null) new BindingResolver().prepare(flow,flow.schedule().inputs());
    }
    private void fileName(String value) {
        if(value==null || !value.matches("[A-Za-z][A-Za-z0-9_.-]{0,99}"))throw WorkflowException.invalid("files","simple named files required; no directories or traversal");
    }
    private void validateTaskBindings(FlowDefinition flow,List<Task> group,String mode,Set<String> inherited) {
        var prior=new HashSet<>(inherited);
        for(Task task:group) {
            var available=new HashSet<>(prior);
            if("core.Dag".equals(mode))ancestors(task,group,available);
            available.remove(task.id());
            if(task.container()!=null) {
                task.container().parameters().forEach((name,b)->{identifier(name,"parameters");validateBinding(b,flow,available,"parameters."+name);});
                task.container().inputFiles().forEach((name,b)->validateBinding(b,flow,available,"inputFiles."+name));
            }
            if(task.http()!=null) {
                validateBinding(task.http().path(),flow,available,"http.path");
                if(task.http().body()!=null)validateBinding(task.http().body(),flow,available,"http.body");
            }
            if(task.sql()!=null)task.sql().parameters().forEach(b->validateBinding(b,flow,available,"sql.parameters"));
            if(task.repeat()!=null) {
                validateBinding(task.repeat().iterations(),flow,available,"repeat.iterations");
                task.repeat().initial().forEach((name,b)->validateBinding(b,flow,available,"repeat.initial."+name));
                var inside=new HashSet<>(available);inside.add(task.id());
                validateTaskBindings(flow,task.tasks(),"core.Sequential",inside);
                task.tasks().forEach(child->completed(child,inside));
                task.repeat().feedback().forEach((name,b)->validateBinding(b,flow,inside,"repeat.feedback."+name));
            } else validateTaskBindings(flow,task.tasks(),task.type(),available);
            validateTaskBindings(flow,task.thenTasks(),"core.Sequential",available);
            validateTaskBindings(flow,task.elseTasks(),"core.Sequential",available);
            if("core.Sequential".equals(mode))completed(task,prior);
        }
    }
    private void ancestors(Task task,List<Task> group,Set<String> available) {
        for(String id:task.dependsOn()) {
            if(available.contains(id))continue;
            var parent=group.stream().filter(t->id.equals(t.id())).findFirst().orElseThrow();
            ancestors(parent,group,available);completed(parent,available);
        }
    }
    private void completed(Task task,Set<String> available) {
        available.add(task.id());if(task.repeat()==null)task.tasks().forEach(t->completed(t,available));
        // An If guarantees its decision, not either branch's artifacts.
    }
    private void validateGroup(List<Task> tasks,boolean dag,int depth) {
        if(depth>16) throw WorkflowException.invalid("tasks","nesting exceeds 16");
        var ids=tasks.stream().map(Task::id).collect(java.util.stream.Collectors.toSet());
        for(var task:tasks) {
            if(!dag && !task.dependsOn().isEmpty()) throw WorkflowException.invalid("dependsOn","only direct Dag children support dependencies");
            if(dag && (!ids.containsAll(task.dependsOn()) || task.dependsOn().contains(task.id()) || new HashSet<>(task.dependsOn()).size()!=task.dependsOn().size()))
                throw WorkflowException.invalid("dependsOn","unknown, self or duplicate dependency");
            boolean branch="core.If".equals(task.type());
            if(branch) {
                if(task.thenTasks().isEmpty() || !task.tasks().isEmpty()) throw WorkflowException.invalid("then","If requires then and forbids tasks");
            } else if(task.condition()!=null || !task.thenTasks().isEmpty() || !task.elseTasks().isEmpty())
                throw WorkflowException.invalid("condition","only If supports condition/then/else");
            if(!branch && task.control() && task.tasks().isEmpty()) throw WorkflowException.invalid("tasks","control group cannot be empty");
            if(!task.control() && !task.tasks().isEmpty()) throw WorkflowException.invalid("tasks","only control tasks contain children");
            validateGroup(task.tasks(),"core.Dag".equals(task.type()),depth+1);
            validateGroup(task.thenTasks(),false,depth+1); validateGroup(task.elseTasks(),false,depth+1);
        }
        if(dag) {
            var done=new HashSet<String>();
            while(done.size()<tasks.size()) {
                int before=done.size();
                for(var task:tasks) if(done.containsAll(task.dependsOn())) done.add(task.id());
                if(before==done.size()) throw WorkflowException.invalid("dependsOn","cyclic dependencies");
            }
        }
    }
    private void duration(String value, String path) {
        try {
            var duration=java.time.Duration.parse(value);
            if (duration.compareTo(java.time.Duration.ofMillis(1))<0 || duration.compareTo(java.time.Duration.ofHours(24))>0)
                throw new IllegalArgumentException();
        } catch (RuntimeException ex) { throw WorkflowException.invalid(path,"ISO-8601 duration between PT0.001S and PT24H required"); }
    }
    private void visitVariable(String name, FlowDefinition flow, Set<String> active, Set<String> done) {
        if (done.contains(name)) return;
        if (!active.add(name)) throw WorkflowException.invalid("variables." + name, "cyclic reference");
        if (flow.variables().get(name) instanceof VariableRef ref) visitVariable(ref.name(), flow, active, done);
        active.remove(name);
        done.add(name);
    }
    private void validateBinding(Binding binding, FlowDefinition flow, Set<String> taskIds, String path) {
        if (binding == null) throw WorkflowException.invalid(path, "binding required");
        switch (binding) {
            case Literal ignored -> { }
            case InputRef ref -> {
                if (!flow.inputs().containsKey(ref.name())) throw WorkflowException.invalid(path, "unknown input");
            }
            case VariableRef ref -> {
                if (!flow.variables().containsKey(ref.name())) throw WorkflowException.invalid(path, "unknown variable");
            }
            case TaskOutputRef ref -> {
                var task=flow.allTasks().stream().filter(t->t.id().equals(ref.taskId())).findFirst().orElse(null);
                String port=task!=null && "core.If".equals(task.type())?"evaluationResult":"message";
                boolean valid=task!=null && (task.repeat()!=null?task.repeat().initial().containsKey(ref.port()) || Set.of("iterations","iterationCount").contains(ref.port()):task.container()!=null?task.container().outputFiles().contains(ref.port()):task.http()!=null?Set.of("statusCode","body").contains(ref.port()):task.sql()!=null?Set.of("rows","size").contains(ref.port()):port.equals(ref.port()) && ("core.Log".equals(task.type()) || "core.If".equals(task.type())));
                if (!taskIds.contains(ref.taskId()) || !valid) {
                    throw WorkflowException.invalid(path, "unknown task output");
                }
            }
        }
    }
}
