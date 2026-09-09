-- Offline upgrade of the independent backend; never reinterpret active S2 executions.
CREATE TEMPORARY TABLE s3_upgrade_guard (active_count INT CHECK (active_count = 0));
INSERT INTO s3_upgrade_guard SELECT COUNT(*) FROM wf_execution WHERE state IN ('CREATED','RUNNING','KILLING');
DROP TEMPORARY TABLE s3_upgrade_guard;
ALTER TABLE wf_execution DROP COLUMN next_task,
 ADD sequence_no BIGINT NOT NULL AUTO_INCREMENT UNIQUE,
 ADD KEY ix_flow_admission(namespace,flow_id,state,sequence_no);
CREATE TABLE wf_flow_control (
 namespace VARCHAR(100) NOT NULL,
 flow_id VARCHAR(100) NOT NULL,
 concurrency_limit INT NULL,
 behavior VARCHAR(10) NOT NULL DEFAULT 'QUEUE',
 PRIMARY KEY(namespace,flow_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE wf_schedule (
 namespace VARCHAR(100) NOT NULL,
 flow_id VARCHAR(100) NOT NULL,
 payload_json LONGTEXT NOT NULL,
 next_fire TIMESTAMP(6) NULL,
 PRIMARY KEY(namespace,flow_id),
 KEY ix_schedule_due(next_fire),
 CONSTRAINT fk_schedule_control FOREIGN KEY(namespace,flow_id) REFERENCES wf_flow_control(namespace,flow_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
