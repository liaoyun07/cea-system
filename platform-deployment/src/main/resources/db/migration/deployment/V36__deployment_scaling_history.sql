CREATE TABLE dep_replica_sample (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    namespace VARCHAR(100) NOT NULL,
    cluster_id VARCHAR(100) NOT NULL,
    kube_namespace VARCHAR(63) NOT NULL,
    deployment_name VARCHAR(63) NOT NULL,
    workload_uid VARCHAR(100) NOT NULL,
    observed_at TIMESTAMP(3) NOT NULL,
    desired INT NOT NULL,
    ready INT NOT NULL,
    standby INT NOT NULL,
    INDEX idx_dep_sample_scope(namespace,cluster_id,kube_namespace,deployment_name,observed_at)
);
CREATE TABLE dep_scaling_event (
    id VARCHAR(36) PRIMARY KEY,
    namespace VARCHAR(100) NOT NULL,
    cluster_id VARCHAR(100) NOT NULL,
    kube_namespace VARCHAR(63) NOT NULL,
    deployment_name VARCHAR(63) NOT NULL,
    workload_uid VARCHAR(100) NOT NULL,
    started_at TIMESTAMP(3) NOT NULL,
    finished_at TIMESTAMP(3),
    from_replicas INT NOT NULL,
    to_replicas INT NOT NULL,
    state VARCHAR(16) NOT NULL,
    duration_ms BIGINT,
    warm_hits INT,
    baseline_pods MEDIUMTEXT NOT NULL,
    standby_pods MEDIUMTEXT NOT NULL,
    end_pods MEDIUMTEXT,
    INDEX idx_dep_scaling_scope(namespace,cluster_id,kube_namespace,deployment_name,started_at)
);
