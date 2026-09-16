package com.project.platform.runtime.worker;

/** Actual external leaf execution boundary. Implementations never mutate Execution state. */
public interface TaskRunner {
    /** Null means no resource yet; a continuation runs only after an execution permit is assigned. */
    default TaskRunner admit(TaskContext context) throws Exception {return this;}
    WorkerJob.Result run(TaskContext context) throws Exception;
}
