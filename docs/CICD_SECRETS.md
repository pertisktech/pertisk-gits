# CI/CD secrets

Group and repository secrets for pipelines. Values are encrypted at rest (AES-256-GCM) and never returned by the API after creation.

## Configuration

Set `SECRETS_ENCRYPTION_KEY` to a 32-byte key (base64 or hex). If unset, the API derives a key from `JWT_SECRET` (development only — set a dedicated key in production).

## Scopes

| Scope | Table | Who can manage | Visibility |
|-------|-------|----------------|------------|
| Group | `organization_secrets` | Org owner/admin | All pipelines in the group |
| Repository | `repository_secrets` | Repo admin or org owner/admin | Pipelines in that repository only |

Repository secrets override group secrets with the same name.

## Pipeline usage

Reference secrets in step `run` scripts and `env` values:

```yaml
jobs:
  deploy:
    steps:
      - run: curl -H "Authorization: Bearer ${{ secrets.API_TOKEN }}" https://api.example.com
        env:
          DEPLOY_KEY_PATH: ${{ secrets.DEPLOY_KEY }}
```

- **variable** — resolves to the secret string.
- **file** — content is written to `.pertisk-secrets/NAME` on the runner (mode 600); the reference resolves to that file path.

## Runner behavior

After a job is claimed, the runner fetches decrypted secrets from `GET /api/v1/runner/jobs/{id}/secrets`, materializes file secrets, resolves `${{ secrets.* }}` in each step, and masks known secret values in streamed logs.

## UI

- **Group → Secrets** — group-level secrets
- **Project → Settings** — repository secrets section
