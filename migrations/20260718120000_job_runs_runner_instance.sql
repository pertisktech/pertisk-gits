-- Track which runner process/pod claimed a job so multi-replica pools can
-- reclaim work when that instance dies while siblings keep heartbeating.
ALTER TABLE job_runs
    ADD COLUMN IF NOT EXISTS runner_instance_id TEXT;

CREATE INDEX IF NOT EXISTS idx_job_runs_runner_instance
    ON job_runs (runner_id, runner_instance_id)
    WHERE status = 'running' AND runner_instance_id IS NOT NULL;
