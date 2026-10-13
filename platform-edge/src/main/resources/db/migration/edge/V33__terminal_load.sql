ALTER TABLE edge_terminal ADD COLUMN resource_json JSON NULL,
    ADD COLUMN resource_at TIMESTAMP(6) NULL,
    ADD COLUMN load_run_id VARCHAR(36) NULL;

CREATE TABLE edge_load_run (
    namespace VARCHAR(100) NOT NULL, id VARCHAR(36) NOT NULL,
    config_json JSON NOT NULL, active_phase INT NOT NULL, sending BOOLEAN NOT NULL,
    created_at TIMESTAMP(6) NOT NULL, stopped_at TIMESTAMP(6) NULL,
    PRIMARY KEY(namespace,id)
);
CREATE TABLE edge_load_phase (
    namespace VARCHAR(100) NOT NULL, run_id VARCHAR(36) NOT NULL, phase_no INT NOT NULL,
    strategy VARCHAR(16) NOT NULL, began_at TIMESTAMP(6) NOT NULL, ended_at TIMESTAMP(6) NULL,
    PRIMARY KEY(namespace,run_id,phase_no)
);
CREATE TABLE edge_load_request (
    namespace VARCHAR(100) NOT NULL, run_id VARCHAR(36) NOT NULL,
    terminal_id VARCHAR(100) NOT NULL, request_id VARCHAR(36) NOT NULL,
    phase_no INT NULL, execution_id VARCHAR(36) NULL,
    accepted_at TIMESTAMP(6) NOT NULL, finished_at TIMESTAMP(6) NULL,
    elapsed_seconds DOUBLE NULL, outcome VARCHAR(24) NULL, error_text VARCHAR(300) NULL,
    PRIMARY KEY(namespace,run_id,terminal_id,request_id),
    INDEX edge_load_execution(namespace,execution_id),
    INDEX edge_load_finished(namespace,run_id,finished_at)
);
CREATE TABLE edge_load_sample (
    id BIGINT NOT NULL AUTO_INCREMENT, namespace VARCHAR(100) NOT NULL,
    run_id VARCHAR(36) NOT NULL, terminal_id VARCHAR(100) NOT NULL,
    sampled_at TIMESTAMP(6) NOT NULL, resource_json JSON NOT NULL,
    PRIMARY KEY(id), INDEX edge_load_sample_run(namespace,run_id,sampled_at)
);
