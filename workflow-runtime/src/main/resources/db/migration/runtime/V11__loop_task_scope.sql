-- Offline upgrade: all dynamic instances must be identified by their parent scope.
CREATE TEMPORARY TABLE s5_loop_upgrade_guard (active_count INT CHECK (active_count = 0));
INSERT INTO s5_loop_upgrade_guard SELECT COUNT(*) FROM wf_execution WHERE state IN ('QUEUED','CREATED','RUNNING','KILLING');
DROP TEMPORARY TABLE s5_loop_upgrade_guard;
ALTER TABLE wf_task_run DROP INDEX uq_task_iteration,
 ADD UNIQUE KEY uq_task_scope (execution_id, task_id, (COALESCE(parent_task_run_id, '')), iteration);
