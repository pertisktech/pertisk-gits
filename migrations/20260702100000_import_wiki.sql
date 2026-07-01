-- Phase 8: optional wiki import during GitHub/GitLab repository import

ALTER TABLE import_jobs
    ADD COLUMN IF NOT EXISTS import_wiki BOOLEAN NOT NULL DEFAULT false;
