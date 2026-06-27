-- Phase 7: machine users, scoped API tokens, GitOps webhooks

ALTER TABLE users
    ADD COLUMN is_machine_user BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE api_tokens
    ADD COLUMN organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    ADD COLUMN repository_id UUID REFERENCES repositories(id) ON DELETE CASCADE,
    ADD COLUMN token_prefix VARCHAR(16);

CREATE INDEX idx_api_tokens_org ON api_tokens(organization_id);
CREATE INDEX idx_api_tokens_repo ON api_tokens(repository_id);

CREATE TABLE gitops_webhooks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    repository_id UUID REFERENCES repositories(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    url TEXT NOT NULL,
    provider VARCHAR(32) NOT NULL DEFAULT 'generic',
    secret TEXT,
    events TEXT[] NOT NULL DEFAULT ARRAY['push']::TEXT[],
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (organization_id, repository_id, name)
);

CREATE INDEX idx_gitops_webhooks_org ON gitops_webhooks(organization_id);
CREATE INDEX idx_gitops_webhooks_repo ON gitops_webhooks(repository_id);
