-- Per-job execution timeout from .pertisk-ci.yaml `timeout_minutes`

ALTER TABLE job_runs
    ADD COLUMN IF NOT EXISTS timeout_minutes INTEGER;
