package com.project.platform.runtime.worker;

import com.project.platform.runtime.persistence.JdbcWorkerStore;

/** Leased access to the durable worker envelope; a lost owner must leave remote work for takeover. */
public final class TaskContext {
    private final JdbcWorkerStore store;
    private final WorkerJob.Lease lease;
    public TaskContext(JdbcWorkerStore store,WorkerJob.Lease lease){this.store=store;this.lease=lease;}
    public WorkerJob job(){return lease.job();}
    public String cancellation() throws InterruptedException {check();return store.cancellation(lease);}
    public String prepared() throws InterruptedException {check();return store.prepared(lease);}
    public void stop(String reason) throws InterruptedException {check();if(!store.stop(lease,reason))throw new InterruptedException("worker lease lost");}
    public void prepare(String value) throws InterruptedException {check();if(!store.prepare(lease,value))throw new InterruptedException("worker lease lost");}
    public void check() throws InterruptedException {
        if(Thread.currentThread().isInterrupted() || !store.owned(lease))throw new InterruptedException("worker lease lost or stopped");
    }
}
