-- Server-level CI secrets/variables (instance scope).
-- Precedence when loading jobs: predefined → instance → organization → repository.

CREATE TABLE instance_secrets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    secret_kind ci_secret_kind NOT NULL DEFAULT 'variable',
    config_scope ci_config_scope NOT NULL DEFAULT 'secret',
    masked BOOLEAN NOT NULL DEFAULT true,
    environment ci_secret_environment NOT NULL DEFAULT 'all',
    encrypted_value BYTEA NOT NULL,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT instance_secrets_name_format CHECK (name ~ '^[A-Z][A-Z0-9_]*$'),
    CONSTRAINT instance_secrets_name_env_key UNIQUE (name, environment)
);

CREATE INDEX idx_instance_secrets_env_name ON instance_secrets (environment, name);
