-- Phase 4: CI/CD pipelines, runners, commit statuses

CREATE TYPE pipeline_event_type AS ENUM ('push', 'pull_request', 'manual');
CREATE TYPE pipeline_run_status AS ENUM ('pending', 'queued', 'running', 'success', 'failure', 'cancelled');
CREATE TYPE job_run_status AS ENUM ('queued', 'running', 'success', 'failure', 'cancelled');
CREATE TYPE commit_status_state AS ENUM ('pending', 'success', 'failure', 'error');
CREATE TYPE runner_status AS ENUM ('online', 'offline', 'busy');

CREATE TABLE runners (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    token_hash VARCHAR(255) NOT NULL UNIQUE,
    labels TEXT[] NOT NULL DEFAULT ARRAY['self-hosted'],
    status runner_status NOT NULL DEFAULT 'offline',
    last_seen_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE pipeline_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    repository_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    commit_sha VARCHAR(40) NOT NULL,
    ref_name VARCHAR(255) NOT NULL,
    event_type pipeline_event_type NOT NULL,
    pull_request_number INTEGER,
    status pipeline_run_status NOT NULL DEFAULT 'pending',
    config_path VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ
);

CREATE INDEX idx_pipeline_runs_repo_created ON pipeline_runs (repository_id, created_at DESC);
CREATE INDEX idx_pipeline_runs_pending ON pipeline_runs (status) WHERE status IN ('pending', 'queued', 'running');

CREATE TABLE job_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pipeline_run_id UUID NOT NULL REFERENCES pipeline_runs(id) ON DELETE CASCADE,
    job_name VARCHAR(100) NOT NULL,
    runs_on VARCHAR(100) NOT NULL DEFAULT 'self-hosted',
    status job_run_status NOT NULL DEFAULT 'queued',
    runner_id UUID REFERENCES runners(id) ON DELETE SET NULL,
    steps_json JSONB NOT NULL DEFAULT '[]',
    metrics_json JSONB,
    log_text TEXT NOT NULL DEFAULT '',
    queued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    UNIQUE (pipeline_run_id, job_name)
);

CREATE INDEX idx_job_runs_queued ON job_runs (status, queued_at) WHERE status = 'queued';

CREATE TABLE commit_statuses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    repository_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    commit_sha VARCHAR(40) NOT NULL,
    context VARCHAR(255) NOT NULL,
    state commit_status_state NOT NULL DEFAULT 'pending',
    description TEXT,
    target_url TEXT,
    pipeline_run_id UUID REFERENCES pipeline_runs(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (repository_id, commit_sha, context)
);

CREATE INDEX idx_commit_statuses_repo_sha ON commit_statuses (repository_id, commit_sha);

CREATE TABLE pipeline_triggers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    repository_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    commit_sha VARCHAR(40) NOT NULL,
    ref_name VARCHAR(255) NOT NULL,
    event_type pipeline_event_type NOT NULL,
    pull_request_number INTEGER,
    processed BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_pipeline_triggers_unprocessed ON pipeline_triggers (processed, created_at) WHERE processed = FALSE;
