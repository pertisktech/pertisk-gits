-- Phase 6.5 phase 2: optional open pull/merge request import

ALTER TABLE import_jobs
    ADD COLUMN import_pull_requests BOOLEAN NOT NULL DEFAULT false;
