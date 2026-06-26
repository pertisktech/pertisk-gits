-- Phase 6.5: Import from GitHub & GitLab

ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'import';

CREATE TYPE import_provider AS ENUM ('github', 'gitlab');

CREATE TYPE import_job_status AS ENUM (
    'pending',
    'mirroring',
    'metadata',
    'done',
    'failed'
);

CREATE TABLE import_credentials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider import_provider NOT NULL,
    base_url TEXT,
    encrypted_token BYTEA NOT NULL,
    label TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, user_id, provider, base_url)
);

CREATE INDEX idx_import_credentials_org ON import_credentials(organization_id);

CREATE TABLE import_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    credential_id UUID NOT NULL REFERENCES import_credentials(id) ON DELETE CASCADE,
    provider import_provider NOT NULL,
    status import_job_status NOT NULL DEFAULT 'pending',
    error_message TEXT,
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_import_jobs_org_created ON import_jobs(organization_id, created_at DESC);
CREATE INDEX idx_import_jobs_status ON import_jobs(status) WHERE status IN ('pending', 'mirroring', 'metadata');

CREATE TABLE import_job_repos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
    source_id TEXT NOT NULL,
    source_full_name TEXT NOT NULL,
    source_clone_url TEXT NOT NULL,
    target_slug TEXT NOT NULL,
    target_name TEXT NOT NULL,
    description TEXT,
    visibility repo_visibility NOT NULL DEFAULT 'private',
    default_branch TEXT,
    repository_id UUID REFERENCES repositories(id) ON DELETE SET NULL,
    status import_job_status NOT NULL DEFAULT 'pending',
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (job_id, source_id)
);

CREATE INDEX idx_import_job_repos_job ON import_job_repos(job_id);
