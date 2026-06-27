-- Phase 7: repository deploy keys (SSH git access)

CREATE TABLE repository_deploy_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    repository_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    public_key TEXT NOT NULL,
    fingerprint VARCHAR(128) NOT NULL,
    read_only BOOLEAN NOT NULL DEFAULT TRUE,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (repository_id, fingerprint),
    UNIQUE (repository_id, title)
);

CREATE INDEX idx_repository_deploy_keys_repo ON repository_deploy_keys(repository_id);
CREATE INDEX idx_repository_deploy_keys_fingerprint ON repository_deploy_keys(fingerprint);
