CREATE TEMPORARY TABLE priority_upgrade_guard (active_count INT CHECK (active_count = 0));
INSERT INTO priority_upgrade_guard SELECT
 (SELECT COUNT(*) FROM wf_execution WHERE state IN ('QUEUED','CREATED','RUNNING','KILLING'))
 + (SELECT COUNT(*) FROM wf_worker_job);
DROP TEMPORARY TABLE priority_upgrade_guard;
ALTER TABLE wf_worker_job
 ADD priority INT NOT NULL DEFAULT 0,
 ADD enqueue_order BIGINT NOT NULL AUTO_INCREMENT,
 ADD UNIQUE KEY uq_worker_enqueue(enqueue_order),
 ADD KEY ix_worker_priority(state,priority,enqueue_order);
