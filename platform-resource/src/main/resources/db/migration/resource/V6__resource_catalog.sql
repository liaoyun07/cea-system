CREATE TABLE res_cluster (
 namespace VARCHAR(100) NOT NULL,
 id VARCHAR(100) NOT NULL,
 kind VARCHAR(10) NOT NULL,
 enabled BOOLEAN NOT NULL,
 PRIMARY KEY(namespace,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE res_dataset_version (
 namespace VARCHAR(100) NOT NULL,
 dataset_id VARCHAR(100) NOT NULL,
 version VARCHAR(100) NOT NULL,
 format VARCHAR(64) NOT NULL,
 PRIMARY KEY(namespace,dataset_id,version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE res_dataset_location (
 namespace VARCHAR(100) NOT NULL,
 dataset_id VARCHAR(100) NOT NULL,
 version VARCHAR(100) NOT NULL,
 cluster_id VARCHAR(100) NOT NULL,
 uri VARCHAR(2048) NOT NULL,
 PRIMARY KEY(namespace,dataset_id,version,cluster_id),
 CONSTRAINT fk_dataset_location_version FOREIGN KEY(namespace,dataset_id,version) REFERENCES res_dataset_version(namespace,dataset_id,version),
 CONSTRAINT fk_dataset_location_cluster FOREIGN KEY(namespace,cluster_id) REFERENCES res_cluster(namespace,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
