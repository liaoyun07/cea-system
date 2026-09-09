CREATE TABLE wf_flow_head (
 namespace VARCHAR(100) NOT NULL,
 flow_id VARCHAR(100) NOT NULL,
 latest_revision INT NOT NULL,
 PRIMARY KEY(namespace,flow_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE wf_flow_revision (
 namespace VARCHAR(100) NOT NULL,
 flow_id VARCHAR(100) NOT NULL,
 revision INT NOT NULL,
 source_text LONGTEXT NOT NULL,
 definition_json LONGTEXT NOT NULL,
 checksum CHAR(64) NOT NULL,
 created_by VARCHAR(100) NOT NULL,
 created_at TIMESTAMP(6) NOT NULL,
 PRIMARY KEY(namespace,flow_id,revision),
 CONSTRAINT fk_revision_head FOREIGN KEY(namespace,flow_id) REFERENCES wf_flow_head(namespace,flow_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

