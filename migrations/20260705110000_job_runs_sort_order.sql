ALTER TABLE job_runs
    ADD COLUMN IF NOT EXISTS sort_order INT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_job_runs_pipeline_sort
    ON job_runs (pipeline_run_id, sort_order);
