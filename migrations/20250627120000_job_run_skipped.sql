-- Skipped jobs (if: condition not met for this run)
ALTER TYPE job_run_status ADD VALUE IF NOT EXISTS 'skipped';
