-- CI environments (dev/qa/uat/prd) for deploy targeting and secret scoping

CREATE TYPE ci_secret_environment AS ENUM ('all', 'dev', 'qa', 'uat', 'prd');

ALTER TABLE organization_secrets
    ADD COLUMN environment ci_secret_environment NOT NULL DEFAULT 'all';

ALTER TABLE repository_secrets
    ADD COLUMN environment ci_secret_environment NOT NULL DEFAULT 'all';

ALTER TABLE organization_secrets
    DROP CONSTRAINT organization_secrets_organization_id_name_key;

ALTER TABLE organization_secrets
    ADD CONSTRAINT organization_secrets_org_name_env_key
    UNIQUE (organization_id, name, environment);

ALTER TABLE repository_secrets
    DROP CONSTRAINT repository_secrets_repository_id_name_key;

ALTER TABLE repository_secrets
    ADD CONSTRAINT repository_secrets_repo_name_env_key
    UNIQUE (repository_id, name, environment);

ALTER TABLE pipeline_runs
    ADD COLUMN target_environment VARCHAR(20);

ALTER TABLE job_runs
    ADD COLUMN effective_environment VARCHAR(20);

CREATE INDEX idx_pipeline_runs_target_env ON pipeline_runs (repository_id, target_environment);
