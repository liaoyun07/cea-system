ALTER TABLE wf_execution ADD COLUMN temporary_outputs_cleaned BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX idx_wf_execution_temporary_cleanup ON wf_execution(temporary_outputs_cleaned, sequence_no);
