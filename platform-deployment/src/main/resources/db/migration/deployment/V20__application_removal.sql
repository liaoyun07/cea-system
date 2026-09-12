-- Retain immutable version identities after catalog removal; never silently reuse an old version.
ALTER TABLE dep_application_version ADD COLUMN deleted BOOLEAN NOT NULL DEFAULT FALSE;
