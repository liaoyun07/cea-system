package com.project.platform.runtime.worker;

import io.fabric8.kubernetes.api.model.*;
import io.fabric8.kubernetes.api.model.batch.v1.*;
import io.fabric8.kubernetes.client.*;
import java.io.*;
import java.util.*;
import com.project.platform.runtime.worker.ContainerTask.*;
import static com.project.platform.runtime.worker.ContainerTask.WRAPPER;

/** Owns one remote Job per Attempt. It never writes Execution/TaskRun state. */
public final class KubernetesJobRunner {
    private static final String ROOT="/cea-work";
    public WorkerJob.Result run(TaskContext context,KubernetesClient client,Spec spec,String helperImage,Transfers files) throws Exception {
        String name=ContainerTask.name(context.job());
        long lastRefresh=0;
        boolean reported=false;
        while(true) {
            context.check();
            String cancellation=context.cancellation();
            Job job=ensure(client,name,spec,helperImage,cancellation!=null);
            var pods=client.pods().withLabel("job-name",name).list().getItems();
            if(!reported) {
                if(pods.size()==1 && pods.getFirst().getStatus()!=null && pods.getFirst().getStatus().getInitContainerStatuses()!=null)
                    for(var init:pods.getFirst().getStatus().getInitContainerStatuses())if("files-in".equals(init.getName()) && init.getState()!=null && init.getState().getTerminated()!=null) {
                        var done=init.getState().getTerminated();String message=done.getMessage();
                        if(done.getExitCode()==0 && message!=null && message.length()<=4096)files.inputReport(message);
                        reported=true;
                    }
            }
            if(cancellation!=null) {
                if(!Boolean.TRUE.equals(job.getSpec().getSuspend()))client.batch().v1().jobs().withName(name).edit(j->{j.getSpec().setSuspend(true);return j;});
                if(stopped(client,name)){removeAuthorization(client,job);return WorkerJob.Result.failed(cancellation);}
            } else if(Boolean.TRUE.equals(job.getSpec().getSuspend())) {
                if(stopped(client,name)){removeAuthorization(client,job);return WorkerJob.Result.failed("remote Job was suspended");}
            } else if(condition(job,"Complete")) {
                var outputs=new LinkedHashMap<String,Object>();
                for(String output:spec.outputs())outputs.put(output,files.published(output));
                removeAuthorization(client,job);
                return WorkerJob.Result.success(outputs);
            } else if(condition(job,"Failed")) {
                removeAuthorization(client,job);return WorkerJob.Result.failed("Kubernetes Job failed; inspect "+name);
            } else {
                if(lastRefresh==0 || System.nanoTime()-lastRefresh>=java.time.Duration.ofMinutes(15).toNanos()) {
                    context.check();authorize(client,job,files.authorization());
                    lastRefresh=System.nanoTime();
                }
                if(pods.size()>1)throw new IllegalStateException("more than one Pod for a non-retrying Attempt");
                if(!pods.isEmpty() && failedContainer(pods.getFirst())) {
                    // A killed main cannot write its exit marker; don't leave the output helper waiting forever.
                    context.check();client.batch().v1().jobs().withName(name).edit(j->{j.getSpec().setSuspend(true);return j;});
                    while(!stopped(client,name)){context.check();Thread.sleep(200);}
                    removeAuthorization(client,job);return WorkerJob.Result.failed("algorithm or file helper failed; inspect "+name);
                }
            }
            Thread.sleep(200);
        }
    }
    private Job ensure(KubernetesClient client,String name,Spec spec,String helperImage,boolean suspended) {
        var existing=client.batch().v1().jobs().withName(name).get();if(existing!=null)return existing;
        var args=new ArrayList<>(List.of("-c",WRAPPER,"cea-task"));args.addAll(spec.command());
        var env=spec.environment().entrySet().stream().map(e->new EnvVar(e.getKey(),e.getValue(),null)).toList();
        var job=new JobBuilder().withNewMetadata().withName(name).endMetadata().withNewSpec()
                .withBackoffLimit(0).withSuspend(suspended).withNewTemplate().withNewMetadata().endMetadata().withNewSpec()
                .withRestartPolicy("Never").withTerminationGracePeriodSeconds(5L).withAutomountServiceAccountToken(false)
                .addNewVolume().withName("work").withNewEmptyDir().endEmptyDir().endVolume()
                .addNewVolume().withName("file-plan").withNewSecret().withSecretName(name+"-files").withDefaultMode(256).endSecret().endVolume()
                .addToInitContainers(helper("files-in",helperImage,"input"))
                .addNewContainer().withName("task").withImage(spec.image()).withImagePullPolicy("IfNotPresent")
                .withCommand("/bin/sh").withArgs(args).withEnv(env).withWorkingDir("/cea-work")
                .addNewVolumeMount().withName("work").withMountPath(ROOT).endVolumeMount()
                .withNewSecurityContext().withAllowPrivilegeEscalation(false).withNewCapabilities().withDrop("ALL").endCapabilities().endSecurityContext()
                .endContainer().addToContainers(helper("files-out",helperImage,"output")).endSpec().endTemplate().endSpec().build();
        try {return client.batch().v1().jobs().resource(job).create();}
        catch(KubernetesClientException ex) {if(ex.getCode()!=409)throw ex;return client.batch().v1().jobs().withName(name).get();}
    }
    private boolean condition(Job job,String type) {
        return job.getStatus()!=null && job.getStatus().getConditions()!=null && job.getStatus().getConditions().stream().anyMatch(c->type.equals(c.getType())&&"True".equals(c.getStatus()));
    }
    private Container helper(String name,String image,String phase) {
        return new ContainerBuilder().withName(name).withImage(image).withImagePullPolicy("IfNotPresent")
                .withCommand("python","/app/transfer.py",phase)
                .addNewVolumeMount().withName("work").withMountPath(ROOT).endVolumeMount()
                .addNewVolumeMount().withName("file-plan").withMountPath("/cea-files").withReadOnly(true).endVolumeMount()
                .withNewSecurityContext().withRunAsUser(0L).withReadOnlyRootFilesystem(true).withAllowPrivilegeEscalation(false)
                .withNewCapabilities().withDrop("ALL").endCapabilities().endSecurityContext().build();
    }
    private boolean failedContainer(Pod pod) {
        if(pod.getStatus()==null)return false;
        var statuses=new ArrayList<ContainerStatus>();
        if(pod.getStatus().getInitContainerStatuses()!=null)statuses.addAll(pod.getStatus().getInitContainerStatuses());
        if(pod.getStatus().getContainerStatuses()!=null)statuses.addAll(pod.getStatus().getContainerStatuses());
        return statuses.stream().anyMatch(c->c.getState()!=null && c.getState().getTerminated()!=null && c.getState().getTerminated().getExitCode()!=0);
    }
    private boolean stopped(KubernetesClient client,String job) {
        return client.pods().withLabel("job-name",job).list().getItems().stream().allMatch(p->p.getStatus()!=null && Set.of("Succeeded","Failed").contains(p.getStatus().getPhase()));
    }
    private void authorize(KubernetesClient client,Job job,String plan) throws IOException {
        byte[] bytes=plan.getBytes(java.nio.charset.StandardCharsets.UTF_8);
        if(bytes.length>900_000)throw new IOException("file authorization exceeds Secret limit");
        String name=job.getMetadata().getName()+"-files";
        var secret=client.secrets().withName(name).get();
        if(secret!=null && (secret.getMetadata().getOwnerReferences()==null || secret.getMetadata().getOwnerReferences().stream().noneMatch(r->job.getMetadata().getUid().equals(r.getUid()))))
            throw new IOException("file authorization is not owned by this Job");
        if(secret==null)secret=new SecretBuilder().withNewMetadata().withName(name)
                .addNewOwnerReference().withApiVersion("batch/v1").withKind("Job").withName(job.getMetadata().getName()).withUid(job.getMetadata().getUid()).endOwnerReference()
                .endMetadata().withType("Opaque").build();
        secret.setData(Map.of("plan.json",Base64.getEncoder().encodeToString(bytes)));
        if(secret.getMetadata().getResourceVersion()==null)client.secrets().resource(secret).create();else client.secrets().resource(secret).update();
    }
    private void removeAuthorization(KubernetesClient client,Job job) throws IOException {
        var secret=client.secrets().withName(job.getMetadata().getName()+"-files").get();
        if(secret==null)return;
        if(secret.getMetadata().getOwnerReferences()==null || secret.getMetadata().getOwnerReferences().stream().noneMatch(r->job.getMetadata().getUid().equals(r.getUid())))
            throw new IOException("refusing to delete authorization not owned by this Job");
        client.secrets().resource(secret).lockResourceVersion(secret.getMetadata().getResourceVersion()).delete();
    }
}
