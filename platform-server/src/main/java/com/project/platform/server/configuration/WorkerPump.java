package com.project.platform.server.configuration;

import com.project.platform.runtime.worker.WorkerEngine;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.beans.factory.annotation.Value;
import jakarta.annotation.PreDestroy;
import java.util.concurrent.*;

@Component
@ConditionalOnProperty(name="platform.worker.enabled",havingValue="true",matchIfMissing=true)
public final class WorkerPump {
    private static final Logger LOG=LoggerFactory.getLogger(WorkerPump.class);
    private final WorkerEngine worker;
    private final Semaphore slots;
    private final ExecutorService pool=Executors.newVirtualThreadPerTaskExecutor();
    public WorkerPump(WorkerEngine worker,@Value("${platform.worker.concurrency:4}") int concurrency) {
        if(concurrency<1||concurrency>100) throw new IllegalArgumentException("worker concurrency must be 1..100");
        this.worker=worker;this.slots=new Semaphore(concurrency);
    }
    @Scheduled(fixedDelayString="${platform.worker.poll-delay-ms:100}")
    public void poll() {
        int available=slots.availablePermits();
        for(int i=0;i<available && slots.tryAcquire();i++) {
            try { pool.submit(()->{
                try { worker.runOnce(); }
                catch(RuntimeException ex) { LOG.error("Worker transport unavailable; lease recovery remains possible",ex); }
                finally { slots.release(); }
            }); } catch(RejectedExecutionException closed) { slots.release();return; }
        }
    }
    @PreDestroy public void close() { pool.shutdownNow(); }
}
