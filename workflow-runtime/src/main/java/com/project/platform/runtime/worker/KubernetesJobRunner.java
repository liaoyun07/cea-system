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
    private static final String FILES_PENDING="cea.platform/files-pending";
    public WorkerJob.Result run(TaskContext context,KubernetesClient client,Spec spec,String helperImage,Transfers files) throws Exception {
        String name=ContainerTask.name(context.job());
        long lastRefresh=0;
        boolean reported=false;
        Pod lastPod=null;
        while(true) {
            context.check();
            String cancellation=context.cancellation();
            Job job=ensure(client,name,spec,helperImage,context.job().task().container().resources());
            var pods=client.pods().withLabel("job-name",name).list().getItems();
            if(pods.size()==1)lastPod=pods.getFirst();
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
                if(stopped(client,name)){removeAuthorization(client,job);return measured(WorkerJob.Result.failed(cancellation),client,job,lastPod);}
            } else if("true".equals(job.getMetadata().getAnnotations()==null?null:job.getMetadata().getAnnotations().get(FILES_PENDING))) {
                if(!Boolean.TRUE.equals(job.getSpec().getSuspend()))throw new IOException("file preparation Job must remain suspended");
                context.check();authorize(client,job,files.authorization());
                context.check();
                if(context.cancellation()==null)client.batch().v1().jobs().withName(name).edit(j->{
                    if(!job.getMetadata().getUid().equals(j.getMetadata().getUid()))throw new IllegalStateException("Job replaced during file preparation");
                    if("true".equals(j.getMetadata().getAnnotations()==null?null:j.getMetadata().getAnnotations().get(FILES_PENDING))) {
                        j.getSpec().setSuspend(false);j.getMetadata().getAnnotations().remove(FILES_PENDING);
                    }
                    return j;
                });
                lastRefresh=System.nanoTime();
            } else if(Boolean.TRUE.equals(job.getSpec().getSuspend())) {
                if(stopped(client,name)){removeAuthorization(client,job);return measured(WorkerJob.Result.failed("remote Job was suspended"),client,job,lastPod);}
            } else if(condition(job,"Complete")) {
                var outputs=new LinkedHashMap<String,Object>();
                for(String output:spec.outputs())outputs.put(output,files.published(output));
                removeAuthorization(client,job);
                return measured(WorkerJob.Result.success(outputs),client,job,lastPod);
            } else if(condition(job,"Failed")) {
                removeAuthorization(client,job);return measured(WorkerJob.Result.failed("Kubernetes Job failed; inspect "+name),client,job,lastPod);
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
                    removeAuthorization(client,job);return measured(WorkerJob.Result.failed("algorithm or file helper failed; inspect "+name),client,job,lastPod);
                }
            }
            Thread.sleep(200);
        }
    }
    private WorkerJob.Result measured(WorkerJob.Result result,KubernetesClient client,Job job,Pod previous) {
        var pods=client.pods().withLabel("job-name",job.getMetadata().getName()).list().getItems();
        return result.withResources(KubernetesResourceReport.read(job,pods.size()==1?pods.getFirst():previous));
    }
    private Job ensure(KubernetesClient client,String name,Spec spec,String helperImage,
                       com.project.platform.runtime.model.FlowDefinition.ContainerResources resources) {
        var existing=client.batch().v1().jobs().withName(name).get();if(existing!=null)return existing;
        // Old helper images used by existing terminal experiments have no meter.
        // Keep those commands working and report MISSING, never fabricate zero cost.
        String launch="if [ -x /cea-work/.cea-tools/resource-meter ]; then exec /cea-work/.cea-tools/resource-meter -- \"$@\"; else exec \"$@\"; fi";
        var args=new ArrayList<>(List.of("-c",launch,"cea-meter","/bin/sh","-c",WRAPPER,"cea-task"));args.addAll(spec.command());
        var env=spec.environment().entrySet().stream().map(e->new EnvVar(e.getKey(),e.getValue(),null)).toList();
        var job=new JobBuilder().withNewMetadata().withName(name).addToAnnotations(FILES_PENDING,"true").endMetadata().withNewSpec()
                .withBackoffLimit(0).withSuspend(true).withNewTemplate().withNewMetadata().endMetadata().withNewSpec()
                .withRestartPolicy("Never").withTerminationGracePeriodSeconds(5L).withAutomountServiceAccountToken(false)
                .addNewVolume().withName("work").withNewEmptyDir().endEmptyDir().endVolume()
                .addNewVolume().withName("file-plan").withNewSecret().withSecretName(name+"-files").withDefaultMode(256).endSecret().endVolume()
                .addToInitContainers(helper("files-in",helperImage,"input"))
                .addNewContainer().withName("task").withImage(spec.image()).withImagePullPolicy("IfNotPresent")
                .withCommand("/bin/sh").withArgs(args).withEnv(env).withWorkingDir("/cea-work")
                .addNewVolumeMount().withName("work").withMountPath(ROOT).endVolumeMount()
                .withNewSecurityContext().withAllowPrivilegeEscalation(false).withNewCapabilities().withDrop("ALL").endCapabilities().endSecurityContext()
                .endContainer().addToContainers(helper("files-out",helperImage,"output")).endSpec().endTemplate().endSpec().build();
        configureTaskResources(job,resources);
        try {return client.batch().v1().jobs().resource(job).create();}
        catch(KubernetesClientException ex) {if(ex.getCode()!=409)throw ex;return client.batch().v1().jobs().withName(name).get();}
    }
    static void configureTaskResources(Job job,com.project.platform.runtime.model.FlowDefinition.ContainerResources resources) {
        if(resources==null || resources.limits()==null)return;
        var limits=new LinkedHashMap<String,Quantity>();
        if(resources.limits().cpu()!=null)limits.put("cpu",new Quantity(resources.limits().cpu()));
        if(resources.limits().memory()!=null)limits.put("memory",new Quantity(resources.limits().memory()));
        if(!limits.isEmpty())job.getSpec().getTemplate().getSpec().getContainers().stream()
                .filter(c->"task".equals(c.getName())).forEach(c->
                    c.setResources(new ResourceRequirementsBuilder().withLimits(limits).build()));
    }
    private boolean condition(Job job,String type) {
        return job.getStatus()!=null && job.getStatus().getConditions()!=null && job.getStatus().getConditions().stream().anyMatch(c->type.equals(c.getType())&&"True".equals(c.getStatus()));
    }
    private Container helper(String name,String image,String phase) {
        String launch="if [ -x /app/resource-meter ]; then exec /app/resource-meter -- \"$@\"; else exec \"$@\"; fi";
        var args=new ArrayList<>(List.of("-c",launch,"cea-meter"));
        if("input".equals(phase))args.addAll(List.of("/bin/sh","-c",
                "if [ -x /app/resource-meter ]; then mkdir -p /cea-work/.cea-tools && cp /app/resource-meter /cea-work/.cea-tools/resource-meter && chmod 755 /cea-work/.cea-tools/resource-meter || exit 1; fi; exec python /app/transfer.py input"));
        else args.addAll(List.of("python","/app/transfer.py",phase));
        return new ContainerBuilder().withName(name).withImage(image).withImagePullPolicy("IfNotPresent")
                .withCommand("/bin/sh").withArgs(args)
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
