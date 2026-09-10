package com.project.platform.runtime.worker;

import io.fabric8.kubernetes.api.model.*;
import io.fabric8.kubernetes.api.model.batch.v1.*;
import io.fabric8.kubernetes.client.*;
import java.io.*;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.TimeUnit;
import com.project.platform.runtime.worker.ContainerTask.*;
import static com.project.platform.runtime.worker.ContainerTask.WRAPPER;

/** Owns one remote Job per Attempt. It never writes Execution/TaskRun state. */
public final class KubernetesJobRunner {
    private static final String ROOT="/cea-work";
    public WorkerJob.Result run(TaskContext context,KubernetesClient client,Spec spec,Filesystem files) throws Exception {
        String name=ContainerTask.name(context.job());
        boolean acknowledged=false;
        while(true) {
            context.check();
            String cancellation=context.cancellation();
            Job job=ensure(client,name,spec,cancellation!=null);
            if(cancellation!=null) {
                if(!Boolean.TRUE.equals(job.getSpec().getSuspend()))client.batch().v1().jobs().withName(name).edit(j->{j.getSpec().setSuspend(true);return j;});
                if(stopped(client,name))return WorkerJob.Result.failed(cancellation);
            } else if(Boolean.TRUE.equals(job.getSpec().getSuspend())) {
                if(stopped(client,name))return WorkerJob.Result.failed("remote Job was suspended");
            } else if(condition(job,"Complete")) {
                var outputs=new LinkedHashMap<String,Object>();
                for(String output:spec.outputs())outputs.put(output,files.published(output));
                return WorkerJob.Result.success(outputs);
            } else if(condition(job,"Failed")) {
                return WorkerJob.Result.failed("Kubernetes Job failed; inspect "+name);
            } else if(!acknowledged) {
                var pods=client.pods().withLabel("job-name",name).list().getItems();
                if(pods.size()>1)throw new IllegalStateException("more than one Pod for a non-retrying Attempt");
                if(!pods.isEmpty() && running(pods.getFirst())) {
                    String pod=pods.getFirst().getMetadata().getName();
                    if(exec(client,pod,"test","-f",ROOT+"/start")==1) {
                        for(String input:spec.inputs()) {
                            context.check();
                            Path temp=Files.createTempFile("cea-input-",".bin");
                            try {files.download(input,temp);upload(client,pod,ROOT+"/in/"+input,temp);}
                            finally {Files.deleteIfExists(temp);}
                        }
                        context.check();
                        if(context.cancellation()==null)marker(client,pod,"start");
                    }
                    if(exec(client,pod,"test","-f",ROOT+"/exit")==0) {
                        String code;
                        try(var stream=client.pods().withName(pod).inContainer("task").file(ROOT+"/exit").read()) {code=new String(stream.readNBytes(32),java.nio.charset.StandardCharsets.UTF_8).trim();}
                        if("0".equals(code))for(String output:spec.outputs()) {
                            context.check();
                            if(exec(client,pod,"test","-f",ROOT+"/out/"+output)!=0) {
                                context.stop("required output file missing: "+output);
                                client.batch().v1().jobs().withName(name).edit(j->{j.getSpec().setSuspend(true);return j;});
                                while(!stopped(client,name)){context.check();Thread.sleep(200);}
                                return WorkerJob.Result.failed("required output file missing: "+output);
                            }
                            Path temp=Files.createTempFile("cea-output-",".bin");
                            try {
                                if(!client.pods().withName(pod).inContainer("task").file(ROOT+"/out/"+output).copy(temp))throw new IOException("cannot collect output file");
                                files.publish(output,temp);
                            } finally {Files.deleteIfExists(temp);}
                        }
                        context.check();marker(client,pod,"published");acknowledged=true;
                    }
                }
            }
            Thread.sleep(200);
        }
    }
    private Job ensure(KubernetesClient client,String name,Spec spec,boolean suspended) {
        var existing=client.batch().v1().jobs().withName(name).get();if(existing!=null)return existing;
        var args=new ArrayList<>(List.of("-c",WRAPPER,"cea-task"));args.addAll(spec.command());
        var env=spec.environment().entrySet().stream().map(e->new EnvVar(e.getKey(),e.getValue(),null)).toList();
        var job=new JobBuilder().withNewMetadata().withName(name).endMetadata().withNewSpec()
                .withBackoffLimit(0).withSuspend(suspended).withNewTemplate().withNewMetadata().endMetadata().withNewSpec()
                .withRestartPolicy("Never").withTerminationGracePeriodSeconds(5L).withAutomountServiceAccountToken(false)
                .addNewVolume().withName("work").withNewEmptyDir().endEmptyDir().endVolume()
                .addNewContainer().withName("task").withImage(spec.image()).withImagePullPolicy("IfNotPresent")
                .withCommand("/bin/sh").withArgs(args).withEnv(env).withWorkingDir("/cea-work")
                .addNewVolumeMount().withName("work").withMountPath(ROOT).endVolumeMount()
                .withNewSecurityContext().withAllowPrivilegeEscalation(false).withNewCapabilities().withDrop("ALL").endCapabilities().endSecurityContext()
                .endContainer().endSpec().endTemplate().endSpec().build();
        try {return client.batch().v1().jobs().resource(job).create();}
        catch(KubernetesClientException ex) {if(ex.getCode()!=409)throw ex;return client.batch().v1().jobs().withName(name).get();}
    }
    private boolean condition(Job job,String type) {
        return job.getStatus()!=null && job.getStatus().getConditions()!=null && job.getStatus().getConditions().stream().anyMatch(c->type.equals(c.getType())&&"True".equals(c.getStatus()));
    }
    private boolean running(Pod pod) {
        return pod.getMetadata().getDeletionTimestamp()==null && pod.getStatus()!=null && pod.getStatus().getContainerStatuses()!=null
                && pod.getStatus().getContainerStatuses().stream().anyMatch(c->"task".equals(c.getName()) && c.getState()!=null && c.getState().getRunning()!=null);
    }
    private boolean stopped(KubernetesClient client,String job) {
        return client.pods().withLabel("job-name",job).list().getItems().stream().allMatch(p->p.getStatus()!=null && Set.of("Succeeded","Failed").contains(p.getStatus().getPhase()));
    }
    private int exec(KubernetesClient client,String pod,String... command) throws Exception {
        try(var watch=client.pods().withName(pod).inContainer("task").writingOutput(OutputStream.nullOutputStream()).writingError(OutputStream.nullOutputStream()).exec(command)) {
            return watch.exitCode().get(30,TimeUnit.SECONDS);
        }
    }
    private void marker(KubernetesClient client,String pod,String name) throws Exception {
        if(exec(client,pod,"touch",ROOT+"/"+name)!=0)throw new IOException("cannot persist Pod marker");
    }
    private void upload(KubernetesClient client,String pod,String name,Path file) throws IOException {
        // Stage bytes only: Path upload preserves host ownership in a tar,
        // which a capability-restricted Pod cannot restore for a non-root Worker.
        try(var input=Files.newInputStream(file)) {
            if(!client.pods().withName(pod).inContainer("task").file(name).upload(input))throw new IOException("cannot stage input file");
        }
    }
}
