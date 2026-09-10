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
import com.project.platform.offloading.OffloadingService;
import com.project.platform.offloading.OffloadingService.*;
import java.nio.file.Path;
import java.util.*;
import java.util.function.Function;

/** Application/resource adaptation only; lifecycle and lease ownership stay in runtime. */
public final class ApplicationTaskRunner implements TaskRunner {
    public record TerminalTarget(String terminalId,String clusterId,String dockerContext,int slots) {}
    public record Prepared(String clusterId,ContainerTask.Spec spec,Map<String,String> inputUris,Map<String,String> inlineFiles,String dockerContext,String terminalId) {}
    private final ApplicationCatalogService applications;
    private final ResourceCatalogService resources;
    private final ImageDistributionService images;
    private final JobPlacementService placement;
    private final KubernetesConnections connections;
    private final ObjectStorage storage;
    private final Function<WorkerJob,Actor> identities;
    private final Function<WorkerJob,TerminalTarget> terminals;
    private final OffloadingService offloading;
    private final JsonCodec json;
    private final BindingResolver bindings;
    private final KubernetesJobRunner runner=new KubernetesJobRunner();
    private final DockerTaskRunner docker=new DockerTaskRunner();
    public ApplicationTaskRunner(ApplicationCatalogService applications,ResourceCatalogService resources,ImageDistributionService images,
            JobPlacementService placement,KubernetesConnections connections,ObjectStorage storage,Function<WorkerJob,Actor> identities,
            Function<WorkerJob,TerminalTarget> terminals,OffloadingService offloading,JsonCodec json,BindingResolver bindings) {
        this.applications=applications;this.resources=resources;this.images=images;this.placement=placement;this.connections=connections;
        this.storage=storage;this.identities=identities;this.terminals=terminals;this.offloading=offloading;this.json=json;this.bindings=bindings;
    }
    @Override public WorkerJob.Result run(TaskContext context) throws Exception {
        var job=context.job();var execution=(Map<?,?>)job.context().get("execution");
        String namespace=(String)execution.get("namespace"),key=job.taskRunId()+"-"+job.attemptNo();
        try {
            String saved=context.prepared();
            if(saved==null && context.cancellation()!=null) {
                complete(context,namespace,key,null);return WorkerJob.Result.failed(context.cancellation());
            }
            Prepared plan=saved==null?prepare(context,namespace,key):json.read(saved,Prepared.class);
            if(plan==null){complete(context,namespace,key,null);return WorkerJob.Result.failed("attempt cancelled before dispatch");}
            var files=new ContainerTask.Filesystem() {
                    public void download(String name,Path destination) throws Exception {
                        if(plan.inlineFiles().containsKey(name))java.nio.file.Files.writeString(destination,plan.inlineFiles().get(name));
                        else storage.download(namespace,plan.inputUris().get(name),destination);
                    }
                    public String publish(String name,Path source) throws Exception {return storage.publish(namespace,job.executionId(),job.taskRunId(),job.attemptNo(),name,source);}
                    public String published(String name) throws Exception {return storage.published(namespace,job.executionId(),job.taskRunId(),job.attemptNo(),name);}
            };
            if(plan.dockerContext()!=null) {
                var result=docker.run(context,plan.dockerContext(),plan.spec(),files);complete(context,namespace,key,result);return result;
            }
            try(var client=connections.open(namespace,plan.clusterId())) {
                var result=runner.run(context,client,plan.spec(),files);
                complete(context,namespace,key,result);return result;
            }
        } catch(InterruptedException ex){throw ex;}
        catch(ApplicationException|ResourceException|WorkflowException|Forbidden ex) {
            // Only pre-dispatch validation may fail immediately. An uncertain remote effect must be reconciled.
            if(context.prepared()==null){complete(context,namespace,key,WorkerJob.Result.failed(ex.getMessage()));return WorkerJob.Result.failed(ex.getMessage());}
            throw new InterruptedException("remote attempt requires reconciliation");
        } catch(Exception ex) {
            // Keep the same durable Job envelope on API/DB/storage transport errors; never blindly retry the business command.
            System.getLogger(ApplicationTaskRunner.class.getName()).log(System.Logger.Level.WARNING,
                    "Remote reconciliation deferred: {0}; taskRun={1}; at={2}",ex.getClass().getName(),job.taskRunId(),ex.getStackTrace().length==0?"unknown":ex.getStackTrace()[0]);
            throw new InterruptedException("external operation outcome unknown; lease takeover will reconcile");
        }
    }
    private void complete(TaskContext context,String ns,String key,WorkerJob.Result result) throws Exception {
        context.check();var sample=offloading.get(ns,key);
        if(sample!=null && "TERMINAL".equals(sample.target().kind())) {
            String prepared=context.prepared();
            if(prepared!=null){var plan=json.read(prepared,Prepared.class);placement.releaseTerminal(ns,key,plan.clusterId(),plan.terminalId());}
            else {var origin=terminals.apply(context.job());placement.releaseTerminal(ns,key,origin.clusterId(),sample.target().id());}
        } else if(sample!=null || context.job().task().container().execution()==com.project.platform.runtime.model.FlowDefinition.ContainerExecution.CLUSTER)placement.release(ns,key);
        context.check();offloading.finish(ns,key,"cancelled".equals(context.cancellation())?"CANCELLED":result!=null && result.success()?"SUCCESS":"FAILED");
    }
    @SuppressWarnings("unchecked")
    private Prepared prepare(TaskContext context,String namespace,String key) throws Exception {
        var c=context.job().task().container();var actor=identities.apply(context.job());
        var app=applications.get(actor,namespace,c.applicationId(),c.version());
        var resolved=new LinkedHashMap<String,Object>();c.parameters().forEach((name,binding)->resolved.put(name,bindings.resolve(binding,context.job().context())));
        var values=ApplicationContractValidator.parameters(app,resolved);
        var requirements=new ArrayList<DatasetRequirement>();
        for(var entry:app.parameters().entrySet())if(entry.getValue().dataset()!=null && values.get(entry.getKey())!=null) {
            String[] ref=values.get(entry.getKey()).toString().split("/",2);
            requirements.add(new DatasetRequirement(ref[0],ref[1],entry.getValue().dataset().format()));
        }
        TerminalTarget origin=c.execution()==com.project.platform.runtime.model.FlowDefinition.ContainerExecution.TERMINAL?terminals.apply(context.job()):null;
        var env=new LinkedHashMap<String,String>();values.forEach((name,value)->{if(value!=null)env.put(name,value.toString());});
        var inputUris=new LinkedHashMap<String,String>();
        var inlineFiles=new LinkedHashMap<String,String>();var names=new HashSet<String>();
        for(var entry:c.inputFiles().entrySet()) {
            Object value=bindings.resolve(entry.getValue(),context.job().context());
            if(value instanceof String uri) {
                reserveName(names,entry.getKey());inputUris.put(entry.getKey(),uri);
            } else if(value instanceof List<?> files && files.size()<=1000 && files.stream().allMatch(String.class::isInstance)) {
                var paths=new ArrayList<String>();
                for(int i=0;i<files.size();i++) {
                    String name=entry.getKey()+".item-"+i;reserveName(names,name);
                    inputUris.put(name,(String)files.get(i));paths.add("/cea-work/in/"+name);
                }
                String manifest=entry.getKey()+".json";reserveName(names,manifest);inlineFiles.put(manifest,json.write(paths));
            } else throw WorkflowException.invalid("inputFiles","S3 URI or array of at most 1000 S3 URIs required");
        }
        inputUris.values().forEach(uri->storage.validateInput(namespace,uri));
        long bytes=0;for(String uri:inputUris.values())bytes=Math.addExact(bytes,storage.size(namespace,uri));
        // Before offloading, a registered location supplies a size estimate; admission records the actual selected files below.
        if(c.offload()!=null)for(var requirement:requirements)bytes=Math.addExact(bytes,storage.size(namespace,resources.dataset(actor,namespace,requirement.datasetId(),requirement.version()).locations().getFirst().uri()));
        var work=new Workload(c.applicationId(),c.version(),c.command(),values,bytes);
        Sample sample=offloading.get(namespace,key);
        String cluster;boolean local=false;
        if(origin!=null) {
            if(sample==null) {
                if(c.offload()==null)sample=offloading.observe(actor,namespace,key,context.job().executionId(),work,new Target("TERMINAL",origin.terminalId()));
                else {
                    var candidates=new ArrayList<Candidate>();
                    if(resources.placementOptions(actor,namespace,new PlacementRequest(List.of(origin.clusterId()),requirements)).getFirst().eligible() && docker.available(context,origin.dockerContext())) {
                        var load=placement.terminalLoad(actor,namespace,origin.clusterId(),origin.terminalId(),origin.slots());
                        candidates.add(new Candidate(new Target("TERMINAL",origin.terminalId()),load.capacity(),load.active(),load.waiting()));
                    }
                    var request=new PlacementRequest(FlowValidator.candidateClusters(bindings.resolve(c.offload().candidateClusters(),context.job().context())),requirements);
                    for(var load:placement.loads(actor,namespace,request))candidates.add(new Candidate(new Target(load.kind().name(),load.clusterId()),load.capacity(),load.active(),load.waiting()));
                    context.check();sample=offloading.decide(actor,namespace,key,context.job().executionId(),work,candidates,c.offload().strategy().name(),c.offload().modelVersion());
                }
            }
            local="TERMINAL".equals(sample.target().kind());cluster=local?origin.clusterId():sample.target().id();
            if(local) {
                while(!placement.reserveTerminal(actor,namespace,key,cluster,origin.terminalId(),origin.slots())) {
                    if(context.cancellation()!=null)return null;Thread.sleep(200);
                }
            } else if(!reserve(context,actor,namespace,key,new PlacementRequest(List.of(cluster),requirements)))return null;
        } else {
            var request=new PlacementRequest(FlowValidator.candidateClusters(bindings.resolve(c.candidateClusters(),context.job().context())),requirements);
            if(!reserve(context,actor,namespace,key,request))return null;
            cluster=placement.get(namespace,key).clusterId();
            sample=offloading.observe(actor,namespace,key,context.job().executionId(),work,new Target(resources.cluster(actor,namespace,cluster).kind().name(),cluster));
        }
        context.check();if(context.cancellation()!=null)return null;
        for(var entry:app.parameters().entrySet())if(entry.getValue().dataset()!=null && values.get(entry.getKey())!=null) {
            String[] ref=values.get(entry.getKey()).toString().split("/",2);String filename="dataset-"+entry.getKey();
            reserveName(names,filename);
            if(env.containsKey(entry.getKey()+"_PATH"))throw WorkflowException.invalid("parameters","dataset path/file name collision");
            String uri=resources.dataset(actor,namespace,ref[0],ref[1]).locations().stream().filter(l->l.clusterId().equals(cluster)).findFirst()
                    .orElseThrow(()->ResourceException.invalid("dataset has no location at the terminal gateway cluster")).uri();
            inputUris.put(filename,uri);env.put(entry.getKey()+"_PATH","/cea-work/in/"+filename);
        }
        inputUris.values().forEach(uri->storage.validateInput(namespace,uri));
        long actualBytes=0;for(String uri:inputUris.values())actualBytes=Math.addExact(actualBytes,storage.size(namespace,uri));
        context.check();offloading.started(actor,namespace,key,actualBytes);
        var image=images.prepareForExecution(actor,namespace,c.applicationId(),c.version(),cluster);
        context.check();if(context.cancellation()!=null)return null;
        var files=new ArrayList<>(inputUris.keySet());files.addAll(inlineFiles.keySet());
        var plan=new Prepared(cluster,new ContainerTask.Spec(image.image(),c.command(),env,List.copyOf(files),c.outputFiles()),inputUris,inlineFiles,local?origin.dockerContext():null,local?origin.terminalId():null);
        context.prepare(json.write(plan));return plan;
    }
    private boolean reserve(TaskContext context,Actor actor,String ns,String key,PlacementRequest request) throws Exception {
        JobPlacementService.Allocation allocation;
        while((allocation=placement.reserve(actor,ns,key,request))==null){if(context.cancellation()!=null)return false;Thread.sleep(200);}
        context.check();return !allocation.released() && context.cancellation()==null;
    }
    private void reserveName(Set<String> names,String name) {
        if(!names.add(name))throw WorkflowException.invalid("inputFiles","expanded file name collision: "+name);
    }
}
