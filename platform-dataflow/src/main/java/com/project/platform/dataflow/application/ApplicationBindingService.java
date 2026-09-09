package com.project.platform.dataflow.application;

import com.project.platform.deployment.application.ApplicationCatalogService;
import com.project.platform.deployment.application.ApplicationContractValidator;
import com.project.platform.deployment.application.ApplicationVersion;
import com.project.platform.deployment.application.ApplicationVersion.Parameter;
import com.project.platform.foundation.identity.AccessPolicy;
import com.project.platform.foundation.identity.AccessPolicy.*;
import com.project.platform.runtime.definition.BindingResolver;
import com.project.platform.runtime.definition.FlowValidator;
import com.project.platform.runtime.model.FlowDefinition.*;
import com.project.platform.runtime.model.WorkflowException;
import com.project.platform.dataflow.application.ApplicationBindings.*;
import java.util.*;

/** Derives editor input definitions and resolves values; never submits executions or creates deployments. */
public final class ApplicationBindingService {
    private final ApplicationCatalogService applications;
    private final BindingResolver resolver;
    private final AccessPolicy access;
    public ApplicationBindingService(ApplicationCatalogService applications,BindingResolver resolver,AccessPolicy access) {
        this.applications=applications;this.resolver=resolver;this.access=access;
    }
    public Plan plan(Actor actor,String namespace,Request request) {
        access.require(actor,namespace,Action.READ);FlowValidator.identifier(namespace,"namespace");
        if(request==null || request.tasks().isEmpty() || request.tasks().size()>100) throw invalid("requires 1..100 tasks");
        var ids=new HashSet<String>();var aliases=new TreeMap<String,List<Parameter>>();var tasks=new ArrayList<TaskBindings>();
        for(var task:request.tasks()) {
            FlowValidator.identifier(task.taskId(),"taskId");
            if(!ids.add(task.taskId())) throw invalid("duplicate taskId: "+task.taskId());
            var contract=applications.get(actor,namespace,task.applicationId(),task.version());
            for(String key:task.aliases().keySet()) if(!contract.parameters().containsKey(key)) throw invalid("unknown parameter: "+key);
            for(String key:task.fixedValues().keySet()) if(!contract.parameters().containsKey(key)) throw invalid("unknown parameter: "+key);
            var bindings=new TreeMap<String,Binding>();
            for(var entry:contract.parameters().entrySet()) {
                String name=entry.getKey();var parameter=entry.getValue();
                if(task.aliases().containsKey(name)) {
                    if(task.fixedValues().containsKey(name)) throw invalid("parameter cannot have both alias and fixed value: "+name);
                    String alias=task.aliases().get(name);FlowValidator.identifier(alias,"alias");
                    aliases.computeIfAbsent(alias,key->new ArrayList<>()).add(parameter);
                    bindings.put(name,new InputRef(alias));
                } else {
                    Object value=task.fixedValues().containsKey(name)?task.fixedValues().get(name):parameter.defaultValue();
                    bindings.put(name,new Literal(ApplicationContractValidator.value(name,parameter,value)));
                }
            }
            tasks.add(new TaskBindings(task.taskId(),contract.applicationId(),contract.version(),contract.image(),bindings));
        }
        var inputs=new TreeMap<String,Input>();var choices=new TreeMap<String,List<Object>>();
        aliases.forEach((alias,parameters)->{
            var first=parameters.getFirst();List<Object> common=null;boolean sameDefault=true,required=false;
            for(var parameter:parameters) {
                if(parameter.type()!=first.type() || (parameter.dataset()==null)!=(first.dataset()==null)) throw invalid("incompatible targets for alias: "+alias);
                required|=parameter.required();sameDefault&=Objects.equals(parameter.defaultValue(),first.defaultValue());
                var allowed=ApplicationContractValidator.choices(parameter);
                if(!allowed.isEmpty()) {
                    if(common==null) common=new ArrayList<>(allowed);else common.retainAll(allowed);
                    if(common.isEmpty()) throw invalid("no common choices for alias: "+alias);
                }
            }
            Object defaultValue=sameDefault?first.defaultValue():null;
            if(defaultValue!=null && common!=null && !common.contains(defaultValue)) { defaultValue=null;sameDefault=false; }
            inputs.put(alias,new Input(InputType.valueOf(first.type().name()),required || !sameDefault,defaultValue));
            if(common!=null) choices.put(alias,List.copyOf(common));
        });
        return new Plan(inputs,choices,tasks);
    }
    public List<ResolvedTask> resolve(Actor actor,String namespace,ResolveRequest request) {
        if(request==null) { access.require(actor,namespace,Action.READ);throw invalid("request required"); }
        var plan=plan(actor,namespace,new Request(request.tasks()));
        var inputs=resolver.prepareInputs(plan.inputs(),request.inputs());var resolved=new ArrayList<ResolvedTask>();
        for(var task:plan.tasks()) {
            ApplicationVersion contract=applications.get(actor,namespace,task.applicationId(),task.version());
            var values=new TreeMap<String,Object>();
            task.parameters().forEach((name,binding)->{
                Object value=ApplicationContractValidator.value(name,contract.parameters().get(name),resolver.resolve(binding,inputs,Map.of(),Map.of()));
                if(value!=null) values.put(name,value);
            });
            resolved.add(new ResolvedTask(task.taskId(),task.applicationId(),task.version(),task.image(),values));
        }
        return List.copyOf(resolved);
    }
    private static WorkflowException invalid(String message) { return WorkflowException.invalid("applicationBindings",message); }
}
