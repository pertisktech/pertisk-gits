-- CI/CD secrets (group + repository scope)

CREATE TYPE ci_secret_kind AS ENUM ('variable', 'file');

CREATE TABLE organization_secrets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    secret_kind ci_secret_kind NOT NULL DEFAULT 'variable',
    encrypted_value BYTEA NOT NULL,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, name),
    CONSTRAINT organization_secrets_name_format CHECK (name ~ '^[A-Z][A-Z0-9_]*$')
);

CREATE INDEX idx_organization_secrets_org ON organization_secrets(organization_id);

CREATE TABLE repository_secrets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    repository_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    secret_kind ci_secret_kind NOT NULL DEFAULT 'variable',
    encrypted_value BYTEA NOT NULL,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (repository_id, name),
    CONSTRAINT repository_secrets_name_format CHECK (name ~ '^[A-Z][A-Z0-9_]*$')
);

CREATE INDEX idx_repository_secrets_repo ON repository_secrets(repository_id);
