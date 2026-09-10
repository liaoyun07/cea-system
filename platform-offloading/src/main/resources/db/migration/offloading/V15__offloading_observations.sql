CREATE TABLE off_task_observation (
 namespace VARCHAR(100) NOT NULL,
 allocation_id VARCHAR(60) NOT NULL,
 execution_id VARCHAR(36) NOT NULL,
 application_id VARCHAR(100) NOT NULL,
 application_version VARCHAR(100) NOT NULL,
 workload_json MEDIUMTEXT NOT NULL,
 input_bytes BIGINT NOT NULL,
 target_kind VARCHAR(10) NOT NULL,
 target_id VARCHAR(100) NOT NULL,
 strategy VARCHAR(10) NULL,
 model_version VARCHAR(100) NULL,
 state_json JSON NULL,
 action_no INT NULL,
 created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 started_at TIMESTAMP(6) NULL,
 finished_at TIMESTAMP(6) NULL,
 outcome VARCHAR(10) NULL,
 PRIMARY KEY(namespace,allocation_id),
 KEY ix_off_profile(namespace,application_id,application_version,target_kind,target_id),
 KEY ix_off_export(namespace,created_at,allocation_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE off_dqn_model (
 namespace VARCHAR(100) NOT NULL,
 version VARCHAR(100) NOT NULL,
 model_json MEDIUMTEXT NOT NULL,
 PRIMARY KEY(namespace,version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
