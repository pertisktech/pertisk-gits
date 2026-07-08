# Feature Draft: GitLab-like Automatic Registry Credentials in CI

## Goal

Provide a GitLab-like developer experience where container registry credentials are available automatically in CI jobs, so users can run:

```yaml
before_script:
  - echo "$CI_REGISTRY_PASSWORD" | docker login "$CI_REGISTRY" -u "$CI_REGISTRY_USER" --password-stdin
```

without manually creating these variables per project.

## Problem

Today, users must manually define registry credentials as project/group secrets and variables before `docker login` works. This is functional but different from GitLab's built-in behavior and causes confusion and failed first-run pipelines.

## Product Outcomes

1. First Docker push pipeline works out-of-the-box for project maintainers.
2. Existing GitLab-style CI snippets run with minimal/no edits.
3. Lower setup friction for migration from GitLab.

## Proposed Built-in CI Variables

Inject these variables automatically at job runtime:

1. `CI_REGISTRY`
2. `CI_REGISTRY_IMAGE`
3. `CI_REGISTRY_USER`
4. `CI_REGISTRY_PASSWORD`

Definitions:

- `CI_REGISTRY`: registry host, from server config/public URL host.
- `CI_REGISTRY_IMAGE`: `${CI_REGISTRY}/${CI_PROJECT_PATH}`.
- `CI_REGISTRY_USER`: ephemeral robot username for this project/pipeline/job.
- `CI_REGISTRY_PASSWORD`: ephemeral token/password bound to the same identity.

## Behavioral Requirements

1. Variables are available in all jobs by default.
2. Credentials permit `pull,push` only for the current project image path.
3. Credentials cannot access other projects unless normal permissions allow it.
4. Credentials expire automatically (short TTL; recommended 1 hour).
5. Credentials are masked in logs and never shown in UI after creation.
6. Existing user-defined secrets/variables continue to override built-ins (current precedence preserved).

## Security Model

### Token strategy

Use short-lived registry credentials minted per job claim:

1. Runner asks API for job payload.
2. API includes ephemeral registry auth material in job secret payload.
3. Runner exports values as environment variables.
4. Token expires at TTL or job completion.

### Scope

Bind push/pull to repository scope only:

- `repository:{org}/{project}:pull,push`

Optionally include catalog pull if needed:

- `registry:catalog:*` only when explicitly enabled.

### Revocation

1. Revoke at job terminal state (success/failed/canceled).
2. Revoke on runner token compromise flow.
3. TTL enforcement by registry token verification.

## UX and Compatibility

### No-config happy path

For projects with registry enabled, this pipeline should work immediately:

```yaml
jobs:
  build-image:
    runs-on: docker
    steps:
      - name: login
        run: echo "$CI_REGISTRY_PASSWORD" | docker login "$CI_REGISTRY" -u "$CI_REGISTRY_USER" --password-stdin
      - name: build and push
        run: |
          docker build -t "$CI_REGISTRY_IMAGE:$CI_COMMIT_SHORT_SHA" .
          docker push "$CI_REGISTRY_IMAGE:$CI_COMMIT_SHORT_SHA"
```

### Fallback behavior

If auto-injection is disabled by admin:

1. Keep current manual secret behavior.
2. Emit clear warning in job log header:
   `Built-in registry credentials are disabled by server policy.`

## Admin Controls

Add server/org toggles:

1. `CI_AUTO_REGISTRY_CREDENTIALS_ENABLED` (default: true)
2. `CI_AUTO_REGISTRY_CREDENTIALS_TTL_SECS` (default: 3600)
3. `CI_AUTO_REGISTRY_SCOPE_MODE` (`project-only` default, `project-and-subpath` optional)

## API and Runner Changes

### API

1. Extend runner job secrets response to include built-in registry credentials.
2. Add issuer for ephemeral registry credentials tied to job id, project id, and scopes.
3. Add audit logs for issuance and use failures.

### Runner

1. Export built-ins into step environment.
2. Ensure masking rules include `CI_REGISTRY_PASSWORD`.
3. Do not print credential values even in debug mode.

## Registry Changes

1. Accept ephemeral credential principal and validate job-bound claims.
2. Enforce scope match against image path.
3. Return clear 403 messages for scope mismatch.

## Migration and Rollout Plan

### Phase 1: Compatibility mode

1. Introduce variables behind feature flag.
2. Keep manual setup docs unchanged.
3. Add docs section: "No-setup registry login (GitLab compatible)".

### Phase 2: Default-on

1. Enable by default for new installations.
2. Add upgrade note for existing instances.
3. Add telemetry counters for adoption and login failure rate.

### Phase 3: UX polish

1. UI badge in CI settings: "Built-in registry auth enabled".
2. One-click pipeline snippet copy button.

## Acceptance Criteria

1. Fresh project with runner can push image using only built-ins.
2. Command succeeds:
   `echo "$CI_REGISTRY_PASSWORD" | docker login "$CI_REGISTRY" -u "$CI_REGISTRY_USER" --password-stdin`
3. `docker push "$CI_REGISTRY_IMAGE:$CI_COMMIT_SHORT_SHA"` succeeds for permitted project.
4. Push to another project path returns 403.
5. Credential reuse after TTL returns 401/403.
6. No secret value appears in logs.

## Non-goals

1. Cross-project write by default.
2. Long-lived static credentials.
3. Replacing existing manual secret workflows.

## Risks

1. Token leakage via shell tracing if masking misses edge cases.
2. Scope parsing bugs may allow over-broad write access.
3. Clock skew may cause premature token expiry.

## Test Plan

1. Unit tests: token claims creation, scope checks, TTL expiry.
2. Integration tests: runner -> login -> push success path.
3. Negative tests: wrong path push, expired token, disabled feature flag.
4. E2E: create project, run pipeline from template, verify registry artifact appears.

## Suggested Documentation Updates

1. CI/CD docs: add built-in registry variables section.
2. Registry docs: add CI auto-auth flow and troubleshooting.
3. Migration docs: GitLab compatibility mapping table.

## GitLab Mapping Table

| GitLab variable | Proposed Pertisk built-in |
|---|---|
| `CI_REGISTRY` | `CI_REGISTRY` |
| `CI_REGISTRY_IMAGE` | `CI_REGISTRY_IMAGE` |
| `CI_REGISTRY_USER` | `CI_REGISTRY_USER` |
| `CI_REGISTRY_PASSWORD` | `CI_REGISTRY_PASSWORD` |

## Open Questions

1. Should credentials be per-job or per-pipeline?
2. Should forked PR pipelines get push scope or pull-only?
3. Should project visibility affect default pull behavior in CI?
4. Do we need an explicit deny-list for protected branches/tags?
