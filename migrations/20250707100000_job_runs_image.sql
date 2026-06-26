-- Per-job container image for Kubernetes executor (GitLab-style image: in .pertisk-ci.yaml).

ALTER TABLE job_runs
    ADD COLUMN IF NOT EXISTS image TEXT;
