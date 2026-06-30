-- Import: skip or override when target group/repo already exists

CREATE TYPE import_on_conflict AS ENUM ('skip', 'override');

ALTER TABLE import_jobs
    ADD COLUMN on_conflict import_on_conflict NOT NULL DEFAULT 'override';

ALTER TYPE import_job_status ADD VALUE IF NOT EXISTS 'skipped';
