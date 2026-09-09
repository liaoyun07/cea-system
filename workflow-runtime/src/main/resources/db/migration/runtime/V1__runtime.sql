CREATE TABLE wf_execution (
 id VARCHAR(36) PRIMARY KEY,
 namespace VARCHAR(100) NOT NULL,
 flow_id VARCHAR(100) NOT NULL,
 flow_revision INT NOT NULL,
 submitted_by VARCHAR(100) NOT NULL,
 request_key VARCHAR(128) NOT NULL,
 request_hash CHAR(64) NOT NULL,
 state VARCHAR(20) NOT NULL,
 next_task INT NOT NULL DEFAULT 0,
 definition_json LONGTEXT NOT NULL,
 inputs_json LONGTEXT NOT NULL,
 variables_json LONGTEXT NOT NULL,
 outputs_json LONGTEXT NOT NULL,
 created_at TIMESTAMP(6) NOT NULL,
 started_at TIMESTAMP(6) NULL,
 ended_at TIMESTAMP(6) NULL,
 error_text TEXT NULL,
 UNIQUE KEY uq_submission (namespace, submitted_by, request_key),
 KEY ix_execution_history (namespace, created_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE wf_task_run (
 id VARCHAR(36) PRIMARY KEY,
 execution_id VARCHAR(36) NOT NULL,
 task_id VARCHAR(100) NOT NULL,
 task_index INT NOT NULL,
 state VARCHAR(20) NOT NULL,
 outputs_json LONGTEXT NOT NULL,
 started_at TIMESTAMP(6) NULL,
 ended_at TIMESTAMP(6) NULL,
 error_text TEXT NULL,
 UNIQUE KEY uq_task_identity (execution_id, task_id),
 UNIQUE KEY uq_task_index (execution_id, task_index),
 CONSTRAINT fk_task_execution FOREIGN KEY (execution_id) REFERENCES wf_execution(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE wf_task_attempt (
 task_run_id VARCHAR(36) NOT NULL,
 attempt_no INT NOT NULL,
 state VARCHAR(20) NOT NULL,
 started_at TIMESTAMP(6) NOT NULL,
 ended_at TIMESTAMP(6) NULL,
 error_text TEXT NULL,
 PRIMARY KEY (task_run_id, attempt_no),
 CONSTRAINT fk_attempt_task FOREIGN KEY (task_run_id) REFERENCES wf_task_run(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE wf_message (
 id BIGINT AUTO_INCREMENT PRIMARY KEY,
 execution_id VARCHAR(36) NOT NULL,
 UNIQUE KEY uq_next_step (execution_id),
 CONSTRAINT fk_message_execution FOREIGN KEY (execution_id) REFERENCES wf_execution(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE wf_log (
 id BIGINT AUTO_INCREMENT PRIMARY KEY,
 execution_id VARCHAR(36) NOT NULL,
 task_run_id VARCHAR(36) NULL,
 attempt_no INT NOT NULL,
 entry_no INT NOT NULL,
 level VARCHAR(10) NOT NULL,
 message LONGTEXT NOT NULL,
 created_at TIMESTAMP(6) NOT NULL,
 UNIQUE KEY uq_attempt_log (task_run_id, attempt_no, entry_no),
 KEY ix_log_execution (execution_id, id),
 CONSTRAINT fk_log_execution FOREIGN KEY (execution_id) REFERENCES wf_execution(id),
 CONSTRAINT fk_log_task FOREIGN KEY (task_run_id) REFERENCES wf_task_run(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
