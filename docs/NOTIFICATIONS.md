# Email notifications (SMTP)

Instance-wide email alerts configured by super admins under **Admin → Configuration → Email notifications**.

## Setup

1. Set **SMTP host**, **port**, **TLS**, credentials, and **from** address.
2. Check **Enable SMTP** and save.
3. Use **Send test email** to verify delivery (saves current form values first).
4. Toggle which events send mail under **Notify on**.

SMTP passwords are encrypted at rest (`SECRETS_ENCRYPTION_KEY` or derived from `JWT_SECRET` in dev).

## Events

| Toggle | When | Recipients |
|--------|------|------------|
| User login | Successful sign-in (password, OIDC, SAML, LDAP) | Signed-in user |
| User registration | New account via `/auth/register` | User; super admins if approval required |
| User approved | Admin approves pending user | Approved user |
| Merge requests | PR opened or merged | Opened → repo write/admin (excl. author); merged → PR author |
| CI/CD pipeline failure | Pipeline run finishes with failed jobs | PR author if PR pipeline, else repo write/admin |

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/admin/notifications/smtp` | Read settings (super admin) |
| PUT | `/api/v1/admin/notifications/smtp` | Update settings |
| POST | `/api/v1/admin/notifications/smtp/test` | Send test email (`{ "to": "optional" }`) |

## Common SMTP ports

| Port | TLS mode | Typical use |
|------|----------|-------------|
| 587 | STARTTLS | Gmail, SendGrid, most providers |
| 465 | Implicit TLS (SMTPS) | Legacy providers |
| 25 / 1025 | Plain (no TLS) | Local dev (Mailpit, MailHog) — disable **Use TLS** |

For Gmail, the **from** address must match the SMTP username or a verified send-as alias.

## Schema

`smtp_settings` — singleton row (`id = 1`): `enabled`, `host`, `port`, `username`, `password_encrypted`, `from_email`, `from_name`, `use_tls`, and per-event `notify_*` flags.

Migrations: `20250722100000_smtp_notifications.sql`, `20250722110000_smtp_user_registration.sql`
