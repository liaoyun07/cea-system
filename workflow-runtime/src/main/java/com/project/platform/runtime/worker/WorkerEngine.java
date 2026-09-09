package com.project.platform.runtime.worker;

import com.project.platform.runtime.definition.TemplateRenderer;
import com.project.platform.runtime.persistence.JdbcWorkerStore;
import com.project.platform.runtime.worker.WorkerJob.Result;
import java.time.Duration;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.*;

/** Executes supported tasks outside DB transactions. Lost leases/shutdown are not business failures. */
public final class WorkerEngine implements AutoCloseable {
    private final JdbcWorkerStore store;
    private final TemplateRenderer renderer;
    private final long leaseMs;
    private final String owner=UUID.randomUUID().toString();
    private final ExecutorService tasks=Executors.newVirtualThreadPerTaskExecutor();
    public WorkerEngine(JdbcWorkerStore store,TemplateRenderer renderer,long leaseMs) {
        if(leaseMs<300 || leaseMs>60000) throw new IllegalArgumentException("worker lease-ms must be 300..60000");
        this.store=store;this.renderer=renderer;this.leaseMs=leaseMs;
    }
    public boolean runOnce() {
        var lease=store.claim(owner,leaseMs);
        if(lease==null) return false;
        Future<Result> future=tasks.submit(()->execute(lease.job()));
        try {
            while(true) {
                try {
                    Result result=future.get(leaseMs/3,TimeUnit.MILLISECONDS);
                    store.finish(lease,result);
                    return true;
                } catch(TimeoutException waiting) {
                    if(!store.heartbeat(lease,leaseMs)) return true;
                } catch(ExecutionException failed) {
                    if(failed.getCause() instanceof InterruptedException) return true;
                    store.finish(lease,Result.failed("task execution failed"));
                    return true;
                }
            }
        } catch(InterruptedException shutdown) {
            Thread.currentThread().interrupt();
            return true;
        } finally {
            if(!future.isDone()) future.cancel(true);
        }
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
