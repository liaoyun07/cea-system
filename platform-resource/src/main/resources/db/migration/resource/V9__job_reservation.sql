CREATE TABLE res_job_reservation (
 namespace VARCHAR(100) NOT NULL,
 allocation_id VARCHAR(60) NOT NULL,
 cluster_id VARCHAR(100) NULL,
 released BOOLEAN NOT NULL DEFAULT FALSE,
 PRIMARY KEY(namespace,allocation_id),
 KEY ix_job_reservation_active(namespace,cluster_id,released),
 CONSTRAINT fk_reservation_cluster FOREIGN KEY(namespace,cluster_id) REFERENCES res_cluster(namespace,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
