package com.project.platform.dataflow.execution;

import com.project.platform.foundation.identity.AccessPolicy.Actor;
import com.project.platform.offloading.OffloadingService;
import com.project.platform.offloading.OffloadingService.*;
import com.project.platform.resource.placement.WorkloadLedger;
import com.project.platform.resource.storage.TransferMeasurements;
import com.project.platform.runtime.definition.JsonCodec;
import com.project.platform.runtime.worker.TaskContext;
import java.net.URI;
import java.util.*;

/** Measured offloading adaptation. No workflow state, physical placement or algorithm SDK. */
public final class OffloadingTaskAdapter {
    private final WorkloadLedger workloads;private final TransferMeasurements transfers;private final OffloadingService offloading;
    private final JsonCodec json;private final TerminalGatewayClient gateway;
    public OffloadingTaskAdapter(WorkloadLedger workloads,TransferMeasurements transfers,OffloadingService offloading,JsonCodec json) {
        this.workloads=workloads;this.transfers=transfers;this.offloading=offloading;this.json=json;this.gateway=new TerminalGatewayClient(json);
    }
    public Sample decide(TaskContext context,Actor actor,String ns,String key,ApplicationTaskRunner.TerminalTarget origin,
                         Workload work,List<Candidate> candidates,List<String> clouds,boolean rawFileOnly) throws Exception {
        var c=context.job().task().container();
        java.util.function.Supplier<Sample> choose=()->offloading.decide(actor,ns,key,context.job().executionId(),work,candidates,c.offload().strategy().name(),c.offload().modelVersion(),
                c.offload().layer()==null?null:Layer.valueOf(c.offload().layer().name()));
        if(origin.gateway()==null || clouds.size()!=1 || work.inputBytes()<1)return choose.get();
        String cloud=clouds.getFirst();
        boolean capture=origin.singleTask() && context.job().task().retry()==null && context.job().attemptNo()==1 && rawFileOnly;
        boolean dqn=c.offload().strategy()==com.project.platform.runtime.model.FlowDefinition.OffloadStrategy.DQN;
        if(dqn && !capture)throw com.project.platform.runtime.model.WorkflowException.invalid("offload","DQN requires a single non-retrying terminal-file task");
        var model=dqn?offloading.model(actor,ns,c.offload().modelVersion()):null;
        if(model!=null)model.validate();
        String bucket=capture?(String)gateway.call(context,origin.gateway(),origin.terminalId(),"storage",Map.of()).get("bucket"):null;
        Double edgeSeconds=null,cloudSeconds=null;
        if(capture) {
            Double upload=transfers.seconds(ns,"terminal:"+origin.terminalId(),"store:"+bucket,work.inputBytes());
            Double edge=transfers.seconds(ns,"store:"+bucket,"cluster:"+origin.clusterId(),work.inputBytes());
            Double central=transfers.seconds(ns,"store:"+bucket,"cluster:"+cloud,work.inputBytes());
            if(upload!=null && edge!=null)edgeSeconds=upload+edge;
            if(upload!=null && central!=null)cloudSeconds=upload+central;
        }
        final Double te=edgeSeconds,tc=cloudSeconds;
        String profile=json.write(Map.of("application",work.applicationId(),"version",work.version(),"command",work.command(),"parameters",new TreeMap<>(work.parameters())));
        context.check();
        return workloads.accept(actor,ns,key,origin.terminalId(),origin.clusterId(),cloud,profile,work.inputBytes(),load->{
            Sample sample;
            Double[] inputs={work.inputBytes()/1048576.0,load.comparable()?load.terminalBytes()/1048576.0:null,
                    load.comparable()?load.edgeBytes()/1048576.0:null,load.comparable()?load.cloudBytes()/1048576.0:null,te,tc};
            String missing=!load.comparable()?"mixed or unmeasured active workload":te==null || tc==null?"transfer calibration incomplete":null;
            var legal=candidates.stream().map(x->x.layer().ordinal()).sorted().toList();
            if(dqn) {
                var state=OffloadingService.normalize(inputs,missing);
                if(state==null)throw com.project.platform.runtime.model.WorkflowException.invalid("offload","DQN state is incomplete: "+missing);
                try {
                    var response=gateway.call(context,origin.gateway(),origin.terminalId(),"offloading/decide",
                            Map.of("model",model,"state",state,"legalActions",legal,"exploration",c.offload().exploration()==null?0.0:c.offload().exploration()));
                    if(!(response.get("action") instanceof Number action) || action.doubleValue()!=action.intValue())
                        throw com.project.platform.runtime.model.WorkflowException.invalid("offload","edge action must be an integer");
                    if(!(response.get("inferenceMs") instanceof Number inferenceMs))
                        throw com.project.platform.runtime.model.WorkflowException.invalid("offload","edge inference time required");
                    sample=offloading.edgeDecision(actor,ns,key,context.job().executionId(),work,c.offload().modelVersion(),legal,action.intValue(),inferenceMs.doubleValue());
                } catch(RuntimeException error) {throw error;} catch(Exception error) {throw new IllegalStateException("edge DQN decision unavailable",error);}
            } else sample=choose.get();
            if(capture) {
                sample=offloading.capture(ns,key,origin.clusterId(),origin.terminalId(),origin.flowId(),inputs,legal,missing);
            }
            return new WorkloadLedger.Choice<>(sample.target().kind(),sample);
        });
    }
    public void uploaded(String ns,String key,String terminal,String file,long bytes,Map<?,?> response) {
        if(!(response.get("transfer") instanceof Map<?,?> measurement))return; // Reused object has no new measured transfer.
        if(!(measurement.get("bytes") instanceof Number count) || count.longValue()!=bytes || !(measurement.get("seconds") instanceof Number elapsed))return;
        if(!Double.isFinite(elapsed.doubleValue()) || elapsed.doubleValue()<=0 || elapsed.doubleValue()>3600)return;
        transfers.record(ns,key,"UPLOAD",file,"terminal:"+terminal,"store:"+URI.create((String)response.get("uri")).getHost(),bytes,elapsed.doubleValue());
    }
    public void downloaded(String ns,String key,String cluster,Map<String,String> inputs,String report) throws Exception {
        Map<?,?> value;
        try {value=json.read(report,Map.class);}catch(Exception invalid){return;}
        if(!(value.get("transfers") instanceof List<?> rows) || rows.size()!=1 || inputs.size()!=1)return;
        if(!(rows.getFirst() instanceof Map<?,?> row) || !(row.get("name") instanceof String name) || !inputs.containsKey(name)
                || !(row.get("bytes") instanceof Number bytes) || !(row.get("seconds") instanceof Number seconds))return;
        // The original materialization path already verified this single immutable file's size.
        // Measurement must not add a new source-store availability dependency after download succeeded.
        var sample=offloading.get(ns,key);
        if(sample==null || bytes.longValue()!=sample.inputBytes() || bytes.longValue()<1 || !Double.isFinite(seconds.doubleValue()) || seconds.doubleValue()<=0 || seconds.doubleValue()>3600)return;
        transfers.record(ns,key,"DOWNLOAD",name,"store:"+URI.create(inputs.get(name)).getHost(),"cluster:"+cluster,bytes.longValue(),seconds.doubleValue());
    }
    public void complete(String ns,String key){workloads.release(ns,key);}
}
