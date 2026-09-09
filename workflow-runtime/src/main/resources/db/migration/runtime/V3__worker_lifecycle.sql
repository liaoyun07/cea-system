-- S2 is an offline upgrade of the new backend only. Never reinterpret an active S1 execution.
CREATE TEMPORARY TABLE s2_upgrade_guard (active_count INT CHECK (active_count = 0));
INSERT INTO s2_upgrade_guard SELECT COUNT(*) FROM wf_execution WHERE state IN ('CREATED','RUNNING');
DROP TEMPORARY TABLE s2_upgrade_guard;
ALTER TABLE wf_execution ADD main_state VARCHAR(20) NULL, ADD cleanup_error TEXT NULL;
UPDATE wf_execution SET main_state=state WHERE state IN ('SUCCESS','FAILED');
ALTER TABLE wf_task_run ADD phase VARCHAR(10) NOT NULL DEFAULT 'MAIN', ADD retry_at TIMESTAMP(6) NULL;
ALTER TABLE wf_message ADD available_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 ADD KEY ix_message_due (available_at,id);
CREATE TABLE wf_worker_job (
 task_run_id VARCHAR(36) NOT NULL,
 attempt_no INT NOT NULL,
 state VARCHAR(16) NOT NULL,
 epoch BIGINT NOT NULL DEFAULT 0,
 owner VARCHAR(36) NULL,
 lease_until TIMESTAMP(6) NULL,
 deadline TIMESTAMP(6) NULL,
 payload_json LONGTEXT NOT NULL,
 result_json LONGTEXT NULL,
 PRIMARY KEY(task_run_id,attempt_no),
 KEY ix_worker_claim(state,lease_until),
 CONSTRAINT fk_job_attempt FOREIGN KEY(task_run_id,attempt_no) REFERENCES wf_task_attempt(task_run_id,attempt_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
