package com.project.platform.dataflow.application;

import com.project.platform.runtime.model.FlowDefinition;
import com.project.platform.runtime.model.FlowDefinition.*;
import java.util.*;

/** Editor/compiler protocol using the existing workflow Input and Binding model. Not an executable Flow. */
public final class ApplicationBindings {
    private ApplicationBindings() {}
    public record TaskSelection(String taskId,String applicationId,String version,Map<String,String> aliases,Map<String,Object> fixedValues) {
        public TaskSelection { aliases=FlowDefinition.immutable(aliases);fixedValues=FlowDefinition.immutable(fixedValues); }
    }
    public record Request(List<TaskSelection> tasks) {
        public Request { tasks=tasks==null?List.of():List.copyOf(tasks); }
    }
    public record TaskBindings(String taskId,String applicationId,String version,String image,Map<String,Binding> parameters) {
        public TaskBindings { parameters=FlowDefinition.immutable(parameters); }
    }
    public record Plan(Map<String,Input> inputs,Map<String,List<Object>> choices,List<TaskBindings> tasks) {
        public Plan { inputs=FlowDefinition.immutable(inputs);choices=FlowDefinition.immutable(choices);tasks=List.copyOf(tasks); }
    }
    public record ResolveRequest(List<TaskSelection> tasks,Map<String,Object> inputs) {
        public ResolveRequest { tasks=tasks==null?List.of():List.copyOf(tasks);inputs=FlowDefinition.immutable(inputs); }
    }
    public record ResolvedTask(String taskId,String applicationId,String version,String image,Map<String,Object> parameters) {
        public ResolvedTask { parameters=FlowDefinition.immutable(parameters); }
    }
}
