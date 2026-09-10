package com.project.platform.dataflow.execution;

import com.project.platform.deployment.application.*;
import com.project.platform.deployment.distribution.ImageDistributionService;
import com.project.platform.foundation.identity.AccessPolicy.*;
import com.project.platform.resource.catalog.*;
import com.project.platform.resource.catalog.ResourceCatalog.*;
import com.project.platform.resource.kubernetes.KubernetesConnections;
import com.project.platform.resource.placement.JobPlacementService;
import com.project.platform.resource.storage.ObjectStorage;
import com.project.platform.runtime.definition.*;
import com.project.platform.runtime.model.WorkflowException;
import com.project.platform.runtime.worker.*;
import java.nio.file.Path;
import java.util.*;
import java.util.function.Function;

/** Application/resource adaptation only; lifecycle and lease ownership stay in runtime. */
public final class ApplicationTaskRunner implements TaskRunner {
    public record Prepared(String clusterId,KubernetesJobRunner.Spec spec,Map<String,String> inputUris) {}
    private final ApplicationCatalogService applications;
    private final ResourceCatalogService resources;
    private final ImageDistributionService images;
    private final JobPlacementService placement;
    private final KubernetesConnections connections;
    private final ObjectStorage storage;
    private final Function<String,Actor> identities;
    private final JsonCodec json;
    private final BindingResolver bindings;
    private final KubernetesJobRunner runner=new KubernetesJobRunner();
    public ApplicationTaskRunner(ApplicationCatalogService applications,ResourceCatalogService resources,ImageDistributionService images,
            JobPlacementService placement,KubernetesConnections connections,ObjectStorage storage,Function<String,Actor> identities,JsonCodec json,BindingResolver bindings) {
        this.applications=applications;this.resources=resources;this.images=images;this.placement=placement;this.connections=connections;
        this.storage=storage;this.identities=identities;this.json=json;this.bindings=bindings;
    }
    @Override public WorkerJob.Result run(TaskContext context) throws Exception {
        var job=context.job();var execution=(Map<?,?>)job.context().get("execution");
        String namespace=(String)execution.get("namespace"),key=job.taskRunId()+"-"+job.attemptNo();
        try {
            String saved=context.prepared();
            if(saved==null && context.cancellation()!=null) {
                placement.release(namespace,key);return WorkerJob.Result.failed(context.cancellation());
            }
            Prepared plan=saved==null?prepare(context,namespace,key,(String)execution.get("submittedBy")):json.read(saved,Prepared.class);
            if(plan==null){placement.release(namespace,key);return WorkerJob.Result.failed("attempt cancelled before dispatch");}
            try(var client=connections.open(namespace,plan.clusterId())) {
                var result=runner.run(context,client,plan.spec(),new KubernetesJobRunner.Filesystem() {
                    public void download(String name,Path destination) throws Exception {storage.download(namespace,plan.inputUris().get(name),destination);}
                    public String publish(String name,Path source) throws Exception {return storage.publish(namespace,job.executionId(),job.taskRunId(),job.attemptNo(),name,source);}
                    public String published(String name) throws Exception {return storage.published(namespace,job.executionId(),job.taskRunId(),job.attemptNo(),name);}
                });
                context.check();placement.release(namespace,key);return result;
            }
        } catch(InterruptedException ex){throw ex;}
        catch(ApplicationException|ResourceException|WorkflowException|Forbidden ex) {
            // Only pre-dispatch validation may fail immediately. An uncertain remote effect must be reconciled.
            if(context.prepared()==null){placement.release(namespace,key);return WorkerJob.Result.failed(ex.getMessage());}
            throw new InterruptedException("remote attempt requires reconciliation");
        } catch(Exception ex) {
            // Keep the same durable Job envelope on API/DB/storage transport errors; never blindly retry the business command.
            System.getLogger(ApplicationTaskRunner.class.getName()).log(System.Logger.Level.WARNING,
                    "Remote reconciliation deferred: {0}; taskRun={1}; at={2}",ex.getClass().getName(),job.taskRunId(),ex.getStackTrace().length==0?"unknown":ex.getStackTrace()[0]);
            throw new InterruptedException("external operation outcome unknown; lease takeover will reconcile");
        }
    }
    @SuppressWarnings("unchecked")
    private Prepared prepare(TaskContext context,String namespace,String key,String submittedBy) throws Exception {
        var c=context.job().task().container();var actor=identities.apply(submittedBy);
        var app=applications.get(actor,namespace,c.applicationId(),c.version());
        var values=ApplicationContractValidator.parameters(app,bindings.outputs(c.parameters(),(Map<String,Object>)context.job().context().get("inputs"),
                (Map<String,Object>)context.job().context().get("vars"),(Map<String,Map<String,Object>>)context.job().context().get("outputs")));
        var requirements=new ArrayList<DatasetRequirement>();
        for(var entry:app.parameters().entrySet())if(entry.getValue().dataset()!=null && values.get(entry.getKey())!=null) {
            String[] ref=values.get(entry.getKey()).toString().split("/",2);
            requirements.add(new DatasetRequirement(ref[0],ref[1],entry.getValue().dataset().format()));
        }
        var request=new PlacementRequest(c.candidateClusters(),requirements);
        JobPlacementService.Allocation allocation;
        while((allocation=placement.reserve(actor,namespace,key,request))==null) {
            if(context.cancellation()!=null)return null;Thread.sleep(200);
        }
        context.check();if(allocation.released() || context.cancellation()!=null)return null;
        String cluster=allocation.clusterId();
        var env=new LinkedHashMap<String,String>();values.forEach((name,value)->{if(value!=null)env.put(name,value.toString());});
        var inputUris=new LinkedHashMap<String,String>();
        for(var entry:c.inputFiles().entrySet()) {
            Object value=bindings.resolve(entry.getValue(),(Map<String,Object>)context.job().context().get("inputs"),
                    (Map<String,Object>)context.job().context().get("vars"),(Map<String,Map<String,Object>>)context.job().context().get("outputs"));
            if(!(value instanceof String uri))throw WorkflowException.invalid("inputFiles","S3 URI string required");
            inputUris.put(entry.getKey(),uri);
        }
        for(var entry:app.parameters().entrySet())if(entry.getValue().dataset()!=null && values.get(entry.getKey())!=null) {
            String[] ref=values.get(entry.getKey()).toString().split("/",2);String filename="dataset-"+entry.getKey();
            if(inputUris.containsKey(filename) || env.containsKey(entry.getKey()+"_PATH"))throw WorkflowException.invalid("parameters","dataset path/file name collision");
            String uri=resources.dataset(actor,namespace,ref[0],ref[1]).locations().stream().filter(l->l.clusterId().equals(cluster)).findFirst().orElseThrow().uri();
            inputUris.put(filename,uri);env.put(entry.getKey()+"_PATH","/cea-work/in/"+filename);
        }
        var image=images.prepareForExecution(actor,namespace,c.applicationId(),c.version(),cluster);
        context.check();if(context.cancellation()!=null)return null;
        var plan=new Prepared(cluster,new KubernetesJobRunner.Spec(image.image(),c.command(),env,List.copyOf(inputUris.keySet()),c.outputFiles()),inputUris);
        context.prepare(json.write(plan));return plan;
    }
}
