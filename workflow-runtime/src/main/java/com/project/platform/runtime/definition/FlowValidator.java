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
            } else if(task.control()) {
                if(task.message()!=null || task.duration()!=null || task.retry()!=null || task.timeout()!=null)
                    throw WorkflowException.invalid("tasks."+task.id(),"control tasks cannot have message/duration/retry/timeout");
                if("core.If".equals(task.type())) renderer.validate(task.condition());
            } else throw WorkflowException.invalid("tasks." + task.id(), "unsupported task type");
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
        flow.outputs().forEach((name, binding) -> {
            identifier(name, "outputs");
            var main=new ArrayList<Task>(); FlowDefinition.flatten(flow.tasks(),main);
            validateBinding(binding, flow, main.stream().filter(t -> "core.Log".equals(t.type()) || "core.If".equals(t.type())).map(Task::id).collect(java.util.stream.Collectors.toSet()), "outputs." + name);
        });
        if(flow.schedule()!=null) new BindingResolver().prepare(flow,flow.schedule().inputs());
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
                if (!taskIds.contains(ref.taskId()) || !port.equals(ref.port())) {
                    throw WorkflowException.invalid(path, "unknown task output");
                }
            }
        }
    }
}
