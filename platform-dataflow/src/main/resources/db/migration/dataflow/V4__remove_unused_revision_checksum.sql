-- Revision checksum had no decision-making consumer. Request idempotency hash remains in runtime.
ALTER TABLE wf_flow_revision DROP COLUMN checksum;
