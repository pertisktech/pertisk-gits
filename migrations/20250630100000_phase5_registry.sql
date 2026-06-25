-- Phase 5: OCI container registry (org-scoped images)

CREATE TABLE container_repositories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, name)
);

CREATE INDEX idx_container_repositories_org ON container_repositories(organization_id);

CREATE TABLE container_blobs (
    digest VARCHAR(128) PRIMARY KEY,
    size_bytes BIGINT NOT NULL,
    media_type VARCHAR(255),
    storage_path TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE container_manifests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    repository_id UUID NOT NULL REFERENCES container_repositories(id) ON DELETE CASCADE,
    digest VARCHAR(128) NOT NULL,
    media_type VARCHAR(255) NOT NULL,
    size_bytes BIGINT NOT NULL,
    payload BYTEA NOT NULL,
    uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (repository_id, digest)
);

CREATE INDEX idx_container_manifests_repo ON container_manifests(repository_id);

CREATE TABLE container_tags (
    repository_id UUID NOT NULL REFERENCES container_repositories(id) ON DELETE CASCADE,
    name VARCHAR(128) NOT NULL,
    manifest_digest VARCHAR(128) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (repository_id, name)
);

CREATE INDEX idx_container_tags_manifest ON container_tags(manifest_digest);
