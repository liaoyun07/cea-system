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
    public record Prepared(String clusterId,ContainerTask.Spec spec,Map<String,String> inputUris,Map<String,String> inlineFiles,Map<String,String> outputUris,String helperImage,String dockerContext,String terminalId) {}
    private final ApplicationCatalogService applications;
    private final ResourceCatalogService resources;
    private final ImageDistributionService images;
    private final JobPlacementService placement;
    private final KubernetesConnections connections;
    private final ObjectStorage storage;
    private final Map<String,Map<String,String>> helpers;
    private final Function<WorkerJob,Actor> identities;
    private final Function<WorkerJob,TerminalTarget> terminals;
    private final OffloadingService offloading;
    private final JsonCodec json;
    private final BindingResolver bindings;
    private final com.project.platform.dataflow.definition.NamespaceFileService namespaceFiles;
    private final KubernetesJobRunner runner=new KubernetesJobRunner();
    private final DockerTaskRunner docker=new DockerTaskRunner();
    public ApplicationTaskRunner(ApplicationCatalogService applications,ResourceCatalogService resources,ImageDistributionService images,
            JobPlacementService placement,KubernetesConnections connections,ObjectStorage storage,Function<WorkerJob,Actor> identities,
            Function<WorkerJob,TerminalTarget> terminals,OffloadingService offloading,JsonCodec json,BindingResolver bindings,
            com.project.platform.dataflow.definition.NamespaceFileService namespaceFiles,Map<String,Map<String,String>> helpers) {
        this.applications=applications;this.resources=resources;this.images=images;this.placement=placement;this.connections=connections;
        this.storage=storage;this.identities=identities;this.terminals=terminals;this.offloading=offloading;this.json=json;this.bindings=bindings;
        this.namespaceFiles=namespaceFiles;
        this.helpers=helpers;
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
            if(plan.dockerContext()!=null) {
                var files=new ContainerTask.Filesystem() {
                    public void download(String name,Path destination) throws Exception {
                        if(plan.inlineFiles().containsKey(name))java.nio.file.Files.writeString(destination,plan.inlineFiles().get(name));
                        else storage.download(namespace,plan.inputUris().get(name),destination);
                    }
                    public String publish(String name,Path source) throws Exception {return storage.publish(namespace,plan.outputUris().get(name),source);}
                    public String published(String name) throws Exception {return storage.published(namespace,plan.outputUris().get(name));}
                };
                var result=docker.run(context,plan.dockerContext(),plan.spec(),files);complete(context,namespace,key,result);return result;
            }
            try(var client=connections.open(namespace,plan.clusterId())) {
                var result=runner.run(context,client,plan.spec(),plan.helperImage(),new ContainerTask.Transfers() {
                    public String authorization() throws Exception {return grants(namespace,plan);}
                    public String published(String name) throws Exception {return storage.published(namespace,plan.outputUris().get(name));}
                });
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
        context.check();var container=context.job().task().container();
        String saved=context.prepared();
        Prepared plan=saved==null?null:json.read(saved,Prepared.class);
        if(plan!=null && plan.dockerContext()!=null)placement.releaseTerminal(ns,key,plan.clusterId(),plan.terminalId());
        else if(!placement.releaseTerminal(ns,key)
                && (container.offload()!=null || container.execution()==com.project.platform.runtime.model.FlowDefinition.ContainerExecution.CLUSTER))placement.release(ns,key);
        if(container.offload()!=null) {
            context.check();offloading.finish(ns,key,"cancelled".equals(context.cancellation())?"CANCELLED":result!=null && result.success()?"SUCCESS":"FAILED");
        }
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
        int textBytes=0;
        for(var entry:c.namespaceFiles().entrySet()) {
            reserveName(names,entry.getKey());var ref=entry.getValue();
            String content=namespaceFiles.forExecution(actor,namespace,ref.path(),ref.revision()).content();
            textBytes+=content.getBytes(java.nio.charset.StandardCharsets.UTF_8).length;
            if(textBytes>262144)throw WorkflowException.invalid("namespaceFiles","at most 256KiB per task");
            inlineFiles.put(entry.getKey(),content);
        }
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
        String cluster;boolean local=false;
        if(origin!=null) {
            if(c.offload()==null) {local=true;cluster=origin.clusterId();}
            else {
                Sample sample=offloading.get(namespace,key);
                if(sample==null) {
                    long bytes=0;for(String uri:inputUris.values())bytes=Math.addExact(bytes,storage.size(namespace,uri));
                    // Offloading cost estimate only; not algorithm throughput measurement.
                    for(var requirement:requirements)bytes=Math.addExact(bytes,storage.size(namespace,resources.dataset(actor,namespace,requirement.datasetId(),requirement.version()).locations().getFirst().uri()));
                    var work=new Workload(c.applicationId(),c.version(),c.command(),values,bytes);
                    var candidates=new ArrayList<Candidate>();
                    if(resources.placementOptions(actor,namespace,new PlacementRequest(List.of(origin.clusterId()),requirements)).getFirst().eligible() && docker.available(context,origin.dockerContext())) {
                        var load=placement.terminalLoad(actor,namespace,origin.clusterId(),origin.terminalId(),origin.slots());
                        candidates.add(new Candidate(Layer.TERMINAL,load.capacity(),load.active(),load.waiting()));
                    }
                    for(var kind:Kind.values()) {
                        var scope=placement.layerScope(actor,namespace,kind,origin.clusterId());
                        if(scope.isEmpty())continue;
                        var loads=placement.loads(actor,namespace,new PlacementRequest(scope,requirements));
                        if(!loads.isEmpty())candidates.add(new Candidate(Layer.valueOf(kind.name()),
                                loads.stream().mapToInt(JobPlacementService.Load::capacity).sum(),
                                loads.stream().mapToInt(JobPlacementService.Load::active).sum(),
                                loads.stream().mapToInt(JobPlacementService.Load::waiting).sum()));
                    }
                    context.check();sample=offloading.decide(actor,namespace,key,context.job().executionId(),work,candidates,c.offload().strategy().name(),c.offload().modelVersion());
                }
                local="TERMINAL".equals(sample.target().kind());
                if(local)cluster=origin.clusterId();
                else {
                    var scope=placement.layerScope(actor,namespace,Kind.valueOf(sample.target().kind()),origin.clusterId());
                    if(scope.isEmpty())throw ResourceException.invalid("selected layer is no longer configured");
                    if(!reserve(context,actor,namespace,key,new PlacementRequest(scope,requirements)))return null;
                    cluster=placement.get(namespace,key).clusterId();
                }
            }
            if(local) {
                while(!placement.reserveTerminal(actor,namespace,key,cluster,origin.terminalId(),origin.slots())) {
                    if(context.cancellation()!=null)return null;Thread.sleep(200);
                }
            }
            if(c.offload()!=null) {
                context.check();offloading.placed(actor,namespace,key,new Target(local?"TERMINAL":resources.cluster(actor,namespace,cluster).kind().name(),local?origin.terminalId():cluster));
            }
        } else {
            var request=new PlacementRequest(FlowValidator.candidateClusters(bindings.resolve(c.candidateClusters(),context.job().context())),requirements);
            if(!reserve(context,actor,namespace,key,request))return null;
            cluster=placement.get(namespace,key).clusterId();
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
        if(c.offload()!=null) {
            long actualBytes=0;for(String uri:inputUris.values())actualBytes=Math.addExact(actualBytes,storage.size(namespace,uri));
            context.check();offloading.started(actor,namespace,key,actualBytes);
        }
        var image=images.prepareForExecution(actor,namespace,c.applicationId(),c.version(),cluster);
        context.check();if(context.cancellation()!=null)return null;
        var files=new ArrayList<>(inputUris.keySet());files.addAll(inlineFiles.keySet());
        var outputs=new LinkedHashMap<String,String>();
        for(String name:c.outputFiles())outputs.put(name,storage.outputUri(namespace,cluster,local,context.job().executionId(),context.job().taskRunId(),context.job().attemptNo(),name));
        String helper=local?null:helpers.getOrDefault(namespace,Map.of()).get(cluster);
        if(!local && (helper==null || helper.isBlank()))throw WorkflowException.invalid("helperImage","file helper is not configured for cluster");
        var plan=new Prepared(cluster,new ContainerTask.Spec(image.image(),c.command(),env,List.copyOf(files),c.outputFiles()),inputUris,inlineFiles,outputs,helper,local?origin.dockerContext():null,local?origin.terminalId():null);
        if(!local && grants(namespace,plan).getBytes(java.nio.charset.StandardCharsets.UTF_8).length>900_000)throw WorkflowException.invalid("inputFiles","file plan exceeds 900000 bytes");
        context.prepare(json.write(plan));return plan;
    }
    private String grants(String namespace,Prepared plan) throws Exception {
        var inputs=new LinkedHashMap<String,String>();var outputs=new LinkedHashMap<String,String>();
        for(var entry:plan.inputUris().entrySet())inputs.put(entry.getKey(),storage.grant(namespace,entry.getValue(),false));
        for(var entry:plan.outputUris().entrySet())outputs.put(entry.getKey(),storage.grant(namespace,entry.getValue(),true));
        return json.write(Map.of("inputs",inputs,"outputs",outputs,"inline",plan.inlineFiles()));
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
