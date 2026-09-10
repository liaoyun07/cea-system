-- Offline upgrade: do not let pre-S4 workers consume the extended transport.
CREATE TEMPORARY TABLE s4_upgrade_guard (active_count INT CHECK (active_count = 0));
INSERT INTO s4_upgrade_guard SELECT COUNT(*) FROM wf_execution WHERE state IN ('QUEUED','CREATED','RUNNING','KILLING');
DROP TEMPORARY TABLE s4_upgrade_guard;
ALTER TABLE wf_worker_job ADD cancel_reason VARCHAR(200) NULL, ADD prepared_json LONGTEXT NULL;
