-- Phase 5: registry git repo link + tag provenance

ALTER TABLE container_repositories
    ADD COLUMN IF NOT EXISTS repository_id UUID REFERENCES repositories(id) ON DELETE SET NULL;

ALTER TABLE container_tags
    ADD COLUMN IF NOT EXISTS commit_sha VARCHAR(64);

CREATE INDEX IF NOT EXISTS idx_container_repositories_git_repo
    ON container_repositories(repository_id);

CREATE INDEX IF NOT EXISTS idx_container_tags_commit
    ON container_tags(commit_sha)
    WHERE commit_sha IS NOT NULL;
