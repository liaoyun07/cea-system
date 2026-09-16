package com.project.platform.runtime.worker;

import com.project.platform.runtime.definition.TemplateRenderer;
import com.project.platform.runtime.persistence.JdbcWorkerStore;
import com.project.platform.runtime.worker.WorkerJob.Result;
import java.time.Duration;
import java.util.Map;
import java.util.UUID;
import java.util.HashSet;
import java.util.concurrent.*;

/** Executes supported tasks outside DB transactions. Lost leases/shutdown are not business failures. */
public final class WorkerEngine implements AutoCloseable {
    private final JdbcWorkerStore store;
    private final TemplateRenderer renderer;
    private final long leaseMs;
    private final TaskRunner runner;
    private final String owner=UUID.randomUUID().toString();
    private final ExecutorService tasks=Executors.newVirtualThreadPerTaskExecutor();
    public WorkerEngine(JdbcWorkerStore store,TemplateRenderer renderer,long leaseMs,TaskRunner runner) {
        if(leaseMs<300 || leaseMs>60000) throw new IllegalArgumentException("worker lease-ms must be 300..60000");
        this.store=store;this.renderer=renderer;this.leaseMs=leaseMs;this.runner=runner;
    }
    public boolean runOnce() {
        var admitted=admitNext();
        if(admitted==null)return false;
        run(admitted);return true;
    }
    public record Admitted(WorkerJob.Lease lease,TaskRunner continuation) {}
    public Admitted admitNext() {
        try(var gate=store.admissionLock()) {
            if(gate==null)return null;
            var skipped=new HashSet<String>();
            while(true) {
                var lease=store.claim(owner,leaseMs,skipped);
                if(lease==null)return null;
                var context=new TaskContext(store,lease);
                TaskRunner task=java.util.Set.of("core.Log","core.Sleep").contains(lease.job().task().type())?c->execute(c.job()):runner;
                try {
                    TaskRunner continuation=await(lease,()->task.admit(context));
                    context.check();
                    if(continuation!=null)return new Admitted(lease,continuation);
                    if(!store.defer(lease))throw new InterruptedException("admission lease lost");
                } catch(InterruptedException ex) {return null;}
                catch(ExecutionException ex) {report(lease,ex.getCause());}
                skipped.add(lease.job().taskRunId());
            }
        } catch(java.sql.SQLException ex){throw new IllegalStateException("Worker admission unavailable",ex);}
    }
    public void run(Admitted admitted) {
        var lease=admitted.lease();
        try {
            Result result=await(lease,()->{var context=new TaskContext(store,lease);context.check();return admitted.continuation().run(context);});
            store.finish(lease,result);
        } catch(InterruptedException ex) { /* Ownership loss is recovered as the same Attempt. */ }
        catch(ExecutionException ex) {report(lease,ex.getCause());}
    }
    private <T> T await(WorkerJob.Lease lease,Callable<T> action) throws InterruptedException,ExecutionException {
        Future<T> future=tasks.submit(action);
        try {
            while(true) {
                try {
                    return future.get(leaseMs/3,TimeUnit.MILLISECONDS);
                } catch(TimeoutException waiting) {
                    if(!store.heartbeat(lease,leaseMs))throw new InterruptedException("worker lease lost");
                }
            }
        } finally {
            if(!future.isDone()) future.cancel(true);
        }
    }
    private void report(WorkerJob.Lease lease,Throwable cause) {
        if(cause instanceof InterruptedException)return;
        System.getLogger(WorkerEngine.class.getName()).log(System.Logger.Level.ERROR,
                "Worker failure {0}; taskRun={1}; frames={2}",cause.getClass().getName(),lease.job().taskRunId(),java.util.Arrays.toString(cause.getStackTrace()));
        if(lease.job().task().container()==null)store.finish(lease,Result.failed("task execution failed"));
    }
    private Result execute(WorkerJob job) throws InterruptedException {
        return switch(job.task().type()) {
            case "core.Log" -> {
                try { yield Result.success(Map.of("message",renderer.render(job.task().message(),job.context()))); }
                catch(com.project.platform.runtime.model.WorkflowException ex) { yield Result.failed(ex.getMessage()); }
            }
            case "core.Sleep" -> {
                Thread.sleep(Duration.parse(job.task().duration()));
                yield Result.success(Map.of());
            }
            default -> throw new IllegalStateException("Unsupported task type");
        };
    }
    @Override public void close() { tasks.shutdownNow(); }
}
