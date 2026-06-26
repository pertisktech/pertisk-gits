-- Phase 7: branch protection rules

CREATE TABLE branch_protection_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    repository_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    branch_pattern TEXT NOT NULL,
    require_pull_request BOOLEAN NOT NULL DEFAULT TRUE,
    required_approvals INT NOT NULL DEFAULT 1 CHECK (required_approvals >= 0),
    require_status_checks BOOLEAN NOT NULL DEFAULT FALSE,
    allow_force_push BOOLEAN NOT NULL DEFAULT FALSE,
    allow_admin_bypass BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (repository_id, branch_pattern)
);

CREATE INDEX idx_branch_protection_repo ON branch_protection_rules(repository_id);
