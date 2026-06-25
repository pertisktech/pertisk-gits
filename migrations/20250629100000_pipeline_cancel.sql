-- Pipeline / step cancellation signals for CI jobs.

ALTER TABLE job_runs
    ADD COLUMN IF NOT EXISTS cancel_requested_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS cancel_step_name VARCHAR(100);

CREATE INDEX IF NOT EXISTS idx_job_runs_cancel_pending
    ON job_runs (status, cancel_requested_at)
    WHERE status = 'running' AND cancel_requested_at IS NOT NULL;
