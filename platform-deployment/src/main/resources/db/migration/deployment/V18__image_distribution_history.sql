CREATE TABLE dep_image_distribution (
 id VARCHAR(36) NOT NULL PRIMARY KEY,
 namespace VARCHAR(100) NOT NULL,
 application_id VARCHAR(100) NOT NULL,
 version VARCHAR(100) NOT NULL,
 cluster_id VARCHAR(100) NOT NULL,
 requested_by VARCHAR(100) NOT NULL,
 source_image VARCHAR(512) NOT NULL,
 target_image VARCHAR(512),
 state VARCHAR(16) NOT NULL,
 started_at TIMESTAMP(6) NOT NULL,
 finished_at TIMESTAMP(6),
 deadline_at TIMESTAMP(6) NOT NULL,
 error VARCHAR(1024),
 KEY ix_distribution_history(namespace,application_id,version,started_at,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
