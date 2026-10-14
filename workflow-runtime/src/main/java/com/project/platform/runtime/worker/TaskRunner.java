package com.project.platform.runtime.worker;

/** Actual external leaf execution boundary. Implementations never mutate Execution state. */
public interface TaskRunner {
    /** Null means no resource yet; admission and its continuation share a bounded Worker permit. */
    default TaskRunner admit(TaskContext context) throws Exception {return this;}
    WorkerJob.Result run(TaskContext context) throws Exception;
}
