-- GitLab-style CI/CD variables vs secrets.
-- secret: value hidden after save, masked in logs by default, use ${{ secrets.NAME }}
-- variable: value visible in UI, optional log masking, use ${{ vars.NAME }}

CREATE TYPE ci_config_scope AS ENUM ('secret', 'variable');

ALTER TABLE organization_secrets
    ADD COLUMN IF NOT EXISTS config_scope ci_config_scope NOT NULL DEFAULT 'secret',
    ADD COLUMN IF NOT EXISTS masked BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE repository_secrets
    ADD COLUMN IF NOT EXISTS config_scope ci_config_scope NOT NULL DEFAULT 'secret',
    ADD COLUMN IF NOT EXISTS masked BOOLEAN NOT NULL DEFAULT true;
