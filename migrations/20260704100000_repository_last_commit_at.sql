-- Last commit timestamp on the default branch (for repo list activity sorting/display).

ALTER TABLE repositories
    ADD COLUMN IF NOT EXISTS last_commit_at TIMESTAMPTZ;
