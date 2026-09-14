CREATE TABLE res_offload_workload (
 namespace VARCHAR(100) NOT NULL,
 allocation_id VARCHAR(60) NOT NULL,
 layer VARCHAR(10) NULL,
 scope_id VARCHAR(100) NULL,
 profile_json MEDIUMTEXT NULL,
 input_bytes BIGINT NULL,
 released BOOLEAN NOT NULL DEFAULT FALSE,
 PRIMARY KEY(namespace,allocation_id),
 KEY ix_res_workload_scope(namespace,layer,scope_id,released)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE res_file_transfer (
 sequence_no BIGINT NOT NULL AUTO_INCREMENT,
 namespace VARCHAR(100) NOT NULL,
 allocation_id VARCHAR(60) NOT NULL,
 stage VARCHAR(12) NOT NULL,
 file_name VARCHAR(100) NOT NULL,
 source_id VARCHAR(150) NOT NULL,
 target_id VARCHAR(150) NOT NULL,
 bytes BIGINT NOT NULL,
 seconds DOUBLE NOT NULL,
 PRIMARY KEY(namespace,allocation_id,stage,file_name),
 UNIQUE KEY uq_res_transfer_order(sequence_no),
 KEY ix_res_transfer_path(namespace,source_id,target_id,sequence_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
