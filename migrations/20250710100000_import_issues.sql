-- Phase 6.5 phase 2: optional issues/labels/milestones import

ALTER TABLE import_jobs
    ADD COLUMN import_issues BOOLEAN NOT NULL DEFAULT false;
