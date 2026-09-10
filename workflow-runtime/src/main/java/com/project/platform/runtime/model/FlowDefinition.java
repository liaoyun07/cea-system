package com.project.platform.runtime.model;

import com.fasterxml.jackson.annotation.*;
import java.util.*;

public record FlowDefinition(
        int schemaVersion, String namespace, String id, String description,
        Map<String, String> labels, Map<String, Input> inputs,
        Map<String, Binding> variables, List<Task> tasks, Map<String, Binding> outputs,
        List<Task> errors, @JsonProperty("finally") List<Task> finallyTasks,
        Concurrency concurrency, Schedule schedule) {
    public FlowDefinition {
        labels = immutable(labels); inputs = immutable(inputs); variables = immutable(variables);
        tasks = list(tasks); outputs = immutable(outputs); errors = list(errors); finallyTasks = list(finallyTasks);
    }
    private static <T> List<T> list(List<T> values) { return values == null ? List.of() : List.copyOf(values); }
    public static <T> Map<String,T> immutable(Map<String,T> source) {
        return Collections.unmodifiableMap(new LinkedHashMap<>(source == null ? Map.of() : source));
    }
    public List<Task> allTasks() {
        var all = new ArrayList<Task>(); flatten(tasks,all); flatten(errors,all); flatten(finallyTasks,all); return List.copyOf(all);
    }
    public static void flatten(List<Task> tasks,List<Task> target) {
        for(var task:tasks) { target.add(task); flatten(task.tasks(),target); flatten(task.thenTasks(),target); flatten(task.elseTasks(),target); }
    }
    public Phase phaseAt(int index) {
        var main=new ArrayList<Task>(); flatten(tasks,main);
        var handlers=new ArrayList<Task>(); flatten(errors,handlers);
        return index<main.size()?Phase.MAIN:index<main.size()+handlers.size()?Phase.ERRORS:Phase.FINALLY;
    }
    public enum Phase { MAIN, ERRORS, FINALLY }
    public enum InputType { STRING, INTEGER, NUMBER, BOOLEAN, OBJECT, ARRAY }
    public record Input(InputType type, Boolean required, Object defaultValue) {
        public Input { required = Boolean.TRUE.equals(required); }
    }
    public record Retry(String type, Integer maxAttempts, String interval) {}
    public record Concurrency(Integer limit, Behavior behavior) {
        public Concurrency { behavior=behavior==null?Behavior.QUEUE:behavior; }
    }
    public enum Behavior { QUEUE, FAIL }
    public record Schedule(String cron,String timezone,Boolean disabled,Map<String,Object> inputs) {
        public Schedule { timezone=timezone==null?"UTC":timezone; disabled=Boolean.TRUE.equals(disabled); inputs=immutable(inputs); }
    }
    public record Task(String id, String type, String message, Retry retry, String timeout, String duration,
                       List<Task> tasks, List<String> dependsOn, String condition,
                       @JsonProperty("then") List<Task> thenTasks, @JsonProperty("else") List<Task> elseTasks,
                       Container container,Http http,Sql sql) {
        public Task { tasks=list(tasks); dependsOn=list(dependsOn); thenTasks=list(thenTasks); elseTasks=list(elseTasks); }
        public boolean control() { return type!=null && Set.of("core.Sequential","core.Parallel","core.Dag","core.If").contains(type); }
    }
    public record Http(String connection,String method,Binding path,Binding body) {}
    public record Sql(String connection,String query,List<Binding> parameters) {public Sql {parameters=list(parameters);}}
    public record Container(String applicationId,String version,List<String> candidateClusters,List<String> command,
                            Map<String,Binding> parameters,Map<String,Binding> inputFiles,List<String> outputFiles) {
        public Container {candidateClusters=list(candidateClusters);command=list(command);parameters=immutable(parameters);inputFiles=immutable(inputFiles);outputFiles=list(outputFiles);}
    }
    @JsonTypeInfo(use = JsonTypeInfo.Id.NAME, property = "source")
    @JsonSubTypes({
        @JsonSubTypes.Type(value = Literal.class, name = "LITERAL"),
        @JsonSubTypes.Type(value = InputRef.class, name = "INPUT"),
        @JsonSubTypes.Type(value = VariableRef.class, name = "VARIABLE"),
        @JsonSubTypes.Type(value = TaskOutputRef.class, name = "TASK_OUTPUT")
    })
    public sealed interface Binding permits Literal, InputRef, VariableRef, TaskOutputRef {}
    public record Literal(Object value) implements Binding {}
    public record InputRef(String name) implements Binding {}
    public record VariableRef(String name) implements Binding {}
    public record TaskOutputRef(String taskId, String port) implements Binding {}
}
