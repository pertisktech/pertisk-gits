# Phase 6 — SSO/LDAP & Audit Logs

Enterprise authentication and org-scoped audit trail.

## SSO / LDAP

| Provider | Flow | JIT provisioning |
|----------|------|------------------|
| OIDC | Authorization code + PKCE | Yes |
| SAML 2.0 | SP-initiated HTTP-Redirect / POST ACS | Yes |
| LDAP | Bind + group search | Yes + group → org mapping |

### Admin UI

- **Settings → SSO / LDAP** (`/settings/auth`) — create, enable, delete providers (group **owners** only)
- **Login page** — shows enabled OIDC/SAML buttons and LDAP forms

### OIDC setup (Google / Azure AD / Okta)

1. Create an OIDC provider in **SSO / LDAP** settings.
2. Register redirect URI: `{GIT_PUBLIC_BASE_URL}/api/v1/auth/oidc/callback`
3. Enable the provider.

Example issuer URLs:

| IdP | Issuer URL |
|-----|------------|
| Google | `https://accounts.google.com` |
| Azure AD | `https://login.microsoftonline.com/{tenant}/v2.0` |
| Okta | `https://{org}.okta.com/oauth2/default` |

### SAML setup

1. Create a SAML provider with IdP entity ID, SSO URL, and certificate (PEM).
2. Configure IdP ACS URL: `{GIT_PUBLIC_BASE_URL}/api/v1/auth/saml/{provider_id}/acs`
3. For development only, set `SAML_SKIP_SIGNATURE_VERIFY=1` (signature verification is not yet enforced in production).

### LDAP setup

1. Create an LDAP provider with URL, service bind DN/password, and base DN.
2. Add **group mappings** via API (`POST /api/v1/admin/auth-providers/{id}/ldap-mappings`) mapping LDAP group DNs to organizations and roles.
3. On login, matching groups sync org membership (insert or update role).

Default filters:

- User: `(uid={username})`
- Groups: `(member={user_dn})`

### API (auth)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/auth/providers` | Public | List enabled providers |
| GET | `/auth/oidc/{id}/login` | Public | Start OIDC flow |
| GET | `/auth/oidc/callback` | Public | OIDC callback → JWT redirect |
| GET | `/auth/saml/{id}/login` | Public | Start SAML flow |
| POST | `/auth/saml/{id}/acs` | Public | SAML ACS → JWT redirect |
| POST | `/auth/ldap/{id}/login` | Public | LDAP bind → JWT |
| GET/POST/PATCH/DELETE | `/admin/auth-providers` | Owner | Manage providers |
| POST/DELETE | `/admin/auth-providers/{id}/ldap-mappings` | Owner | LDAP group maps |

Optional env: `AUTH_ADMIN_USER_IDS` — comma-separated UUIDs with provider admin access without org owner role.

## Audit logs

Append-only `audit_events` table. Events recorded today:

- Password and SSO login
- Org member add / update / remove
- Pull request merge

### Org admin UI

**Groups → {org} → Audit log** (`/groups/{slug}/audit`)

- Filter by event type
- Export CSV (up to 10k rows)

### API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/organizations/{org}/audit-events` | List events (owner/admin) |
| GET | `/organizations/{org}/audit-events/export` | CSV export |

Query params: `event_type`, `actor_user_id`, `from`, `to`, `limit`, `offset`.

## Schema

`migrations/20250701100000_phase6_sso_audit.sql`

- `auth_providers`, `ldap_group_mappings`, `user_external_identities`, `auth_flow_states`
- `audit_events`
- `users.password_hash` nullable for SSO-only accounts

## Environment

```bash
# Optional: grant auth provider admin without org owner role
# AUTH_ADMIN_USER_IDS=uuid1,uuid2

# Dev only — accept SAML responses without signature verification
# SAML_SKIP_SIGNATURE_VERIFY=1
```

See [docs/PHASES.md](./PHASES.md) for the full roadmap.
