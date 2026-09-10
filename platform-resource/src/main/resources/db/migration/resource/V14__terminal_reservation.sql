CREATE TABLE res_terminal_reservation (
 sequence_no BIGINT NOT NULL AUTO_INCREMENT,
 namespace VARCHAR(100) NOT NULL,
 allocation_id VARCHAR(60) NOT NULL,
 cluster_id VARCHAR(100) NOT NULL,
 terminal_id VARCHAR(100) NOT NULL,
 admitted BOOLEAN NOT NULL DEFAULT FALSE,
 released BOOLEAN NOT NULL DEFAULT FALSE,
 PRIMARY KEY(sequence_no),
 UNIQUE KEY uq_terminal_allocation(namespace,allocation_id),
 KEY ix_terminal_fifo(namespace,cluster_id,terminal_id,released,admitted,sequence_no),
 CONSTRAINT fk_terminal_reservation_cluster FOREIGN KEY(namespace,cluster_id) REFERENCES res_cluster(namespace,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
