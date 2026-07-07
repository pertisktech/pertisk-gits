-- Registry redesign: project-scoped repositories with provider support

ALTER TABLE container_repositories
    ADD COLUMN IF NOT EXISTS provider VARCHAR(32) NOT NULL DEFAULT 'pertisk';

-- Best-effort backfill for legacy org/image rows where image name matched project slug.
UPDATE container_repositories cr
SET repository_id = r.id
FROM repositories r
WHERE cr.repository_id IS NULL
  AND r.organization_id = cr.organization_id
  AND r.slug = cr.name;

CREATE UNIQUE INDEX IF NOT EXISTS idx_container_repositories_project_provider
    ON container_repositories(repository_id, provider)
    WHERE repository_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_container_repositories_provider
    ON container_repositories(provider);
