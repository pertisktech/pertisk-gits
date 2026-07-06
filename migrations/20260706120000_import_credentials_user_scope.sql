-- Reuse the same GitHub/GitLab PAT across all groups (per user + instance).

UPDATE import_credentials
SET base_url = CASE provider::text
    WHEN 'github' THEN 'https://github.com'
    WHEN 'gitlab' THEN 'https://gitlab.com'
    ELSE COALESCE(base_url, '')
END
WHERE base_url IS NULL OR base_url = '';

DELETE FROM import_credentials a
USING import_credentials b
WHERE a.user_id = b.user_id
  AND a.provider = b.provider
  AND a.base_url = b.base_url
  AND a.updated_at < b.updated_at;

ALTER TABLE import_credentials
    DROP CONSTRAINT IF EXISTS import_credentials_organization_id_user_id_provider_base_url_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_import_credentials_user_provider_url
    ON import_credentials (user_id, provider, base_url);
