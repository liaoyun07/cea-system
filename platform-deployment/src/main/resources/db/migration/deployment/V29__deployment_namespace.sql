ALTER TABLE dep_deployment_record
 ADD COLUMN kube_namespace VARCHAR(63) NULL AFTER cluster_id,
 DROP INDEX ix_deployment_history,
 ADD KEY ix_deployment_history(namespace,cluster_id,kube_namespace,deployment_name,started_at,id);

-- Existing rows are assigned their connection's original default Namespace at startup.
-- The value is deployment-specific configuration, not a hard-coded SQL default.
