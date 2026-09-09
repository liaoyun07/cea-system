CREATE TABLE dep_application_version (
 namespace VARCHAR(100) NOT NULL,
 application_id VARCHAR(100) NOT NULL,
 version VARCHAR(100) NOT NULL,
 contract_json MEDIUMTEXT NOT NULL,
 PRIMARY KEY(namespace,application_id,version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
