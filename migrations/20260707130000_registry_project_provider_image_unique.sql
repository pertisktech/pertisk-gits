-- Allow multiple container images per project/provider.
-- Previous redesign used (repository_id, provider) uniqueness which blocked
-- GitLab-style paths like provider/org/project/image.

DROP INDEX IF EXISTS idx_container_repositories_project_provider;

CREATE UNIQUE INDEX IF NOT EXISTS idx_container_repositories_project_provider_image
    ON container_repositories(repository_id, provider, name)
    WHERE repository_id IS NOT NULL;
