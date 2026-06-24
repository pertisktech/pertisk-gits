ALTER TABLE job_runs
    ADD COLUMN IF NOT EXISTS artifacts_json JSONB NOT NULL DEFAULT '[]';

CREATE TABLE IF NOT EXISTS job_artifacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_run_id UUID NOT NULL REFERENCES job_runs(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    path TEXT NOT NULL,
    storage_key TEXT NOT NULL,
    size_bytes BIGINT NOT NULL,
    content_type TEXT NOT NULL DEFAULT 'application/gzip',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_job_artifacts_job_run_id ON job_artifacts(job_run_id);
