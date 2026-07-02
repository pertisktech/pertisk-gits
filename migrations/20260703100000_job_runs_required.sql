-- Track whether a job failure should block the pipeline and downstream jobs.

ALTER TABLE job_runs
    ADD COLUMN IF NOT EXISTS required BOOLEAN NOT NULL DEFAULT TRUE;
