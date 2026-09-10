package com.project.platform.runtime.worker;

/** Actual external leaf execution boundary. Implementations never mutate Execution state. */
public interface TaskRunner {
    WorkerJob.Result run(TaskContext context) throws Exception;
}
