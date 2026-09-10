-- Offline upgrade; older Executors identify TaskRuns only by taskId.
CREATE TEMPORARY TABLE s5_upgrade_guard (active_count INT CHECK (active_count = 0));
INSERT INTO s5_upgrade_guard SELECT COUNT(*) FROM wf_execution WHERE state IN ('QUEUED','CREATED','RUNNING','KILLING');
DROP TEMPORARY TABLE s5_upgrade_guard;
ALTER TABLE wf_task_run
 ADD parent_task_run_id VARCHAR(36) NULL,
 ADD iteration INT NOT NULL DEFAULT 0,
 DROP INDEX uq_task_identity,
 ADD UNIQUE KEY uq_task_iteration (execution_id,task_id,iteration),
 ADD CONSTRAINT fk_repeat_parent FOREIGN KEY (parent_task_run_id) REFERENCES wf_task_run(id);
