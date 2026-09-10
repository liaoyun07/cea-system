CREATE TABLE edge_gateway (
 namespace VARCHAR(100) NOT NULL, id VARCHAR(100) NOT NULL,
 cluster_id VARCHAR(100) NOT NULL, principal VARCHAR(100) NOT NULL,
 enabled BOOLEAN NOT NULL, last_seen_at TIMESTAMP(6) NULL,
 PRIMARY KEY(namespace,id), UNIQUE KEY uq_gateway_principal(namespace,principal)
);
CREATE TABLE edge_terminal (
 namespace VARCHAR(100) NOT NULL, id VARCHAR(100) NOT NULL,
 gateway_id VARCHAR(100) NOT NULL, enabled BOOLEAN NOT NULL,
 last_seen_at TIMESTAMP(6) NULL,
 PRIMARY KEY(namespace,id),
 FOREIGN KEY(namespace,gateway_id) REFERENCES edge_gateway(namespace,id)
);
CREATE TABLE edge_policy (
 namespace VARCHAR(100) NOT NULL, id VARCHAR(100) NOT NULL,
 cluster_id VARCHAR(100) NOT NULL, event_type VARCHAR(100) NOT NULL,
 enabled BOOLEAN NOT NULL,
 PRIMARY KEY(namespace,id), UNIQUE KEY uq_policy_event(namespace,cluster_id,event_type)
);
CREATE TABLE edge_submission (
 namespace VARCHAR(100) NOT NULL, terminal_id VARCHAR(100) NOT NULL,
 request_key VARCHAR(128) NOT NULL, request_hash CHAR(64) NOT NULL,
 execution_id VARCHAR(36) NOT NULL,
 PRIMARY KEY(namespace,terminal_id,request_key),
 UNIQUE KEY uq_edge_execution(namespace,execution_id),
 FOREIGN KEY(namespace,terminal_id) REFERENCES edge_terminal(namespace,id)
);
