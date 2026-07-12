use axum::{
    http::{header, HeaderMap, HeaderValue},
    response::{Html, IntoResponse},
};
use chrono::{Duration, Utc};
use pertisk_domain::{models::*, DomainError};
use rand::RngCore;
use sqlx::PgPool;
use uuid::Uuid;

use crate::{password::hash_password, ApiError, AppState};

pub mod ldap;
pub mod oidc;
pub mod providers;
pub mod saml;

pub use providers::sso_routes;

pub async fn load_provider(pool: &PgPool, provider_id: Uuid) -> Result<AuthProvider, ApiError> {
    sqlx::query_as::<_, AuthProvider>(
        r#"
        SELECT
            id, name, provider_type, enabled,
            issuer_url, client_id, client_secret, scopes,
            idp_entity_id, idp_sso_url, idp_certificate, sp_entity_id,
            ldap_url, ldap_bind_dn, ldap_bind_password, ldap_base_dn,
            ldap_user_filter, ldap_email_attr, ldap_display_name_attr,
            ldap_username_attr, ldap_group_filter,
            created_at, updated_at
        FROM auth_providers
        WHERE id = $1
        "#,
    )
    .bind(provider_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?
    .ok_or(DomainError::NotFound.into())
}

pub fn ensure_enabled_provider(provider: &AuthProvider) -> Result<(), ApiError> {
    if !provider.enabled {
        return Err(DomainError::Validation("auth provider is disabled".into()).into());
    }
    Ok(())
}

pub fn public_base_url(state: &AppState) -> String {
    state.config.git_public_base_url.clone()
}

pub fn api_callback_url(state: &AppState, path: &str) -> String {
    format!("{}/api/v1{}", public_base_url(state), path)
}

pub fn frontend_callback_url(state: &AppState, token: &str) -> String {
    format!(
        "{}/auth/callback?token={}",
        public_base_url(state),
        urlencoding::encode(token)
    )
}

pub fn frontend_login_url_with_error(state: &AppState, message: &str) -> String {
    format!(
        "{}/login?error={}",
        public_base_url(state),
        urlencoding::encode(message)
    )
}

pub(crate) type SsoHtmlPage = (HeaderMap, Html<String>);

fn sso_html_headers() -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("no-store, no-cache"),
    );
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/html; charset=utf-8"),
    );
    headers
}

fn html_escape_attr(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('<', "&lt;")
}

/// Client-side navigation to an external or internal URL.
///
/// Required when a reverse proxy follows HTTP redirects on HTTP/3 (OIDC login start).
pub fn browser_redirect_response(target_url: &str) -> SsoHtmlPage {
    let href = html_escape_attr(target_url);
    let target_js = serde_json::to_string(target_url).unwrap_or_else(|_| "\"/\"".into());
    let html = format!(
        r#"<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="refresh" content="0;url={href}">
<title>Redirecting…</title>
</head>
<body>
<p>Redirecting… <a href="{href}">Continue</a></p>
<script>location.replace({target_js});</script>
</body>
</html>"#
    );
    (sso_html_headers(), Html(html))
}

/// Complete SSO in the browser without an HTTP redirect (OIDC/SAML callback).
///
/// Writes the session to `localStorage` and navigates to `/dashboard` in one step.
/// Passing the token via `/auth/callback#token=…` was unreliable (hash lost before React loaded).
pub fn browser_session_response(state: &AppState, auth: &AuthResponse) -> SsoHtmlPage {
    let dashboard = format!("{}/dashboard", public_base_url(state));
    let dashboard_js = serde_json::to_string(&dashboard).unwrap_or_else(|_| "\"/dashboard\"".into());
    let token_js = serde_json::to_string(&auth.token).unwrap_or_else(|_| "\"\"".into());
    let user_js = serde_json::json!({
        "id": auth.user.id,
        "username": auth.user.username,
        "email": auth.user.email,
        "display_name": auth.user.display_name,
        "created_at": auth.user.created_at,
        "is_super_admin": auth.is_super_admin,
    });
    let user_js = serde_json::to_string(&user_js).unwrap_or_else(|_| "\"{}\"".into());
    let html = format!(
        r#"<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Signing in…</title></head>
<body>
<p>Signing in…</p>
<script>
localStorage.setItem("pertisk_token", {token_js});
localStorage.setItem("pertisk_user", {user_js});
location.replace({dashboard_js});
</script>
</body>
</html>"#
    );
    (sso_html_headers(), Html(html))
}

pub fn browser_login_error_response(state: &AppState, message: &str) -> SsoHtmlPage {
    browser_redirect_response(&frontend_login_url_with_error(state, message))
}

pub async fn store_flow_state(
    pool: &PgPool,
    provider_id: Uuid,
    code_verifier: Option<String>,
    nonce: Option<String>,
    redirect_after: Option<String>,
) -> Result<String, ApiError> {
    let state = random_token(32);
    let expires_at = Utc::now() + Duration::minutes(10);

    sqlx::query(
        r#"
        INSERT INTO auth_flow_states (state, provider_id, code_verifier, nonce, redirect_after, expires_at)
        VALUES ($1, $2, $3, $4, $5, $6)
        "#,
    )
    .bind(&state)
    .bind(provider_id)
    .bind(code_verifier)
    .bind(nonce)
    .bind(redirect_after)
    .bind(expires_at)
    .execute(pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    Ok(state)
}

pub struct FlowState {
    pub provider_id: Uuid,
    pub code_verifier: Option<String>,
    pub nonce: Option<String>,
    pub redirect_after: Option<String>,
}

pub async fn take_flow_state(pool: &PgPool, state: &str) -> Result<FlowState, ApiError> {
    let row = sqlx::query_as::<_, (Uuid, Option<String>, Option<String>, Option<String>)>(
        r#"
        DELETE FROM auth_flow_states
        WHERE state = $1 AND expires_at > NOW()
        RETURNING provider_id, code_verifier, nonce, redirect_after
        "#,
    )
    .bind(state)
    .fetch_optional(pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?
    .ok_or(DomainError::Validation("invalid or expired auth state".into()))?;

    Ok(FlowState {
        provider_id: row.0,
        code_verifier: row.1,
        nonce: row.2,
        redirect_after: row.3,
    })
}

pub fn random_token(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    rand::thread_rng().fill_bytes(&mut buf);
    base64::Engine::encode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, buf)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use pertisk_domain::models::AuthProviderType;

    #[test]
    fn random_token_has_expected_length() {
        let token = random_token(32);
        assert!(!token.is_empty());
        assert_ne!(random_token(32), random_token(32));
    }

    #[test]
    fn ensure_enabled_provider_rejects_disabled() {
        let provider = AuthProvider {
            id: Uuid::new_v4(),
            name: "oidc".into(),
            provider_type: AuthProviderType::Oidc,
            enabled: false,
            issuer_url: None,
            client_id: None,
            client_secret: None,
            scopes: "openid".into(),
            idp_entity_id: None,
            idp_sso_url: None,
            idp_certificate: None,
            sp_entity_id: None,
            ldap_url: None,
            ldap_bind_dn: None,
            ldap_bind_password: None,
            ldap_base_dn: None,
            ldap_user_filter: String::new(),
            ldap_email_attr: "mail".into(),
            ldap_display_name_attr: "cn".into(),
            ldap_username_attr: "uid".into(),
            ldap_group_filter: String::new(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };
        assert!(ensure_enabled_provider(&provider).is_err());
    }
}

#[derive(Clone)]
pub struct ExternalUser {
    pub subject: String,
    pub email: String,
    pub display_name: Option<String>,
    pub username_hint: Option<String>,
}

pub(crate) fn normalize_email(email: &str) -> String {
    email.trim().to_ascii_lowercase()
}

pub(crate) fn is_placeholder_sso_email(email: &str) -> bool {
    email.trim().to_ascii_lowercase().ends_with("@sso.local")
}

pub async fn jit_provision_user(
    pool: &PgPool,
    provider: &AuthProvider,
    external: &ExternalUser,
) -> Result<User, ApiError> {
    let external = ExternalUser {
        email: normalize_email(&external.email),
        ..external.clone()
    };
    if external.email.is_empty() || is_placeholder_sso_email(&external.email) {
        return Err(DomainError::Validation(
            "SSO login requires a valid email from your identity provider".into(),
        )
        .into());
    }

    if let Some(existing_id) = sqlx::query_scalar::<_, Uuid>(
        r#"
        SELECT user_id FROM user_external_identities
        WHERE provider_id = $1 AND external_subject = $2
        "#,
    )
    .bind(provider.id)
    .bind(&external.subject)
    .fetch_optional(pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?
    {
        let user = load_user_by_id(pool, existing_id).await?;
        if normalize_email(&user.email) == external.email {
            return Ok(user);
        }

        if let Some(correct_id) = find_user_id_by_email(pool, &external.email).await? {
            if correct_id != existing_id {
                sqlx::query(
                    r#"
                    DELETE FROM user_external_identities
                    WHERE provider_id = $1 AND external_subject = $2
                    "#,
                )
                .bind(provider.id)
                .bind(&external.subject)
                .execute(pool)
                .await
                .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;
            } else {
                return Ok(user);
            }
        } else {
            return Ok(user);
        }
    }

    if let Some(user_id) = find_user_id_by_email(pool, &external.email).await? {
        ensure_can_link_provider_identity(pool, provider.id, user_id, &external.subject).await?;
        link_external_identity(pool, user_id, provider.id, &external).await?;
        return load_user_by_id(pool, user_id).await;
    }

    let username = unique_username(pool, &external).await?;
    let display_name = external.display_name.clone();

    let user = sqlx::query_as::<_, User>(
        r#"
        INSERT INTO users (username, email, password_hash, display_name, approval_status, approved_at)
        VALUES ($1, $2, NULL, $3, 'approved', NOW())
        RETURNING id, username, email, password_hash, display_name, is_super_admin, is_machine_user,
                  approval_status, approved_at, approved_by, created_at, updated_at
        "#,
    )
    .bind(&username)
    .bind(&external.email)
    .bind(&display_name)
    .fetch_one(pool)
    .await
    .map_err(|e| match e {
        sqlx::Error::Database(db) if db.constraint().is_some() => {
            ApiError::from(DomainError::Conflict(
                "could not provision user — username or email already exists".into(),
            ))
        }
        other => ApiError::from(DomainError::Internal(other.to_string())),
    })?;

    link_external_identity(pool, user.id, provider.id, &external).await?;

    Ok(user)
}

async fn find_user_id_by_email(pool: &PgPool, email: &str) -> Result<Option<Uuid>, ApiError> {
    sqlx::query_scalar(
        r#"
        SELECT id FROM users WHERE LOWER(email) = LOWER($1)
        "#,
    )
    .bind(email)
    .fetch_optional(pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))
}

async fn ensure_can_link_provider_identity(
    pool: &PgPool,
    provider_id: Uuid,
    user_id: Uuid,
    external_subject: &str,
) -> Result<(), ApiError> {
    let existing_subject = sqlx::query_scalar::<_, String>(
        r#"
        SELECT external_subject
        FROM user_external_identities
        WHERE provider_id = $1 AND user_id = $2
        "#,
    )
    .bind(provider_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    if let Some(subject) = existing_subject {
        if subject != external_subject {
            return Err(DomainError::Conflict(
                "account is already linked to a different SSO identity for this provider".into(),
            )
            .into());
        }
    }

    Ok(())
}

async fn link_external_identity(
    pool: &PgPool,
    user_id: Uuid,
    provider_id: Uuid,
    external: &ExternalUser,
) -> Result<(), ApiError> {
    sqlx::query(
        r#"
        INSERT INTO user_external_identities (user_id, provider_id, external_subject, external_email)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (provider_id, external_subject) DO UPDATE SET
            user_id = EXCLUDED.user_id,
            external_email = EXCLUDED.external_email
        "#,
    )
    .bind(user_id)
    .bind(provider_id)
    .bind(&external.subject)
    .bind(&external.email)
    .execute(pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    Ok(())
}

async fn unique_username(pool: &PgPool, external: &ExternalUser) -> Result<String, ApiError> {
    let base = external
        .username_hint
        .as_deref()
        .or_else(|| external.email.split('@').next())
        .unwrap_or("user");
    let sanitized = sanitize_username(base);
    let mut candidate = sanitized.clone();
    for i in 0i32..100 {
        if i > 0 {
            candidate = format!("{}_{}", sanitized, i + 1);
            if candidate.len() > 39 {
                let trim = 39usize.saturating_sub(2 + (i as usize).ilog10() as usize + 1);
                candidate = format!("{}_{}", &sanitized[..trim.min(sanitized.len())], i + 1);
            }
        }
        let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM users WHERE username = $1)")
            .bind(&candidate)
            .fetch_one(pool)
            .await
            .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;
        if !exists {
            return Ok(candidate);
        }
    }
    Err(DomainError::Internal("could not allocate username".into()).into())
}

fn sanitize_username(raw: &str) -> String {
    let lower = raw.to_ascii_lowercase();
    let mut out = String::with_capacity(lower.len().min(39));
    for ch in lower.chars() {
        if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
            if out.len() < 39 {
                out.push(ch);
            }
        } else if ch == '.' || ch == '+' {
            if !out.is_empty() && out.len() < 39 {
                out.push('_');
            }
        }
    }
    if out.is_empty() {
        "user".to_string()
    } else {
        out
    }
}

pub async fn load_user_by_id(pool: &PgPool, user_id: Uuid) -> Result<User, ApiError> {
    sqlx::query_as::<_, User>(
        r#"
        SELECT id, username, email, password_hash, display_name, is_super_admin, is_machine_user,
               approval_status, approved_at, approved_by, created_at, updated_at
        FROM users WHERE id = $1
        "#,
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?
    .ok_or(DomainError::NotFound.into())
}

pub async fn issue_auth_response(
    state: &AppState,
    user: User,
    method: &str,
    login_ctx: crate::request_context::LoginContext,
) -> Result<pertisk_domain::models::AuthResponse, ApiError> {
    crate::admin::ensure_user_record_approved(&user)?;

    let token = pertisk_domain::auth::create_token(
        user.id,
        &user.username,
        &state.config.jwt_secret,
        72,
    )
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    let is_super_admin = crate::admin::is_super_admin(&state.pool, user.id).await?;

    crate::notifications::notify_login(
        state.pool.clone(),
        state.secrets_crypto.clone(),
        user.id,
        method,
        login_ctx,
    );

    Ok(pertisk_domain::models::AuthResponse {
        token,
        user: UserPublic {
            id: user.id,
            username: user.username,
            email: user.email,
            display_name: user.display_name,
            created_at: user.created_at,
        },
        is_super_admin,
    })
}

pub async fn sync_ldap_group_memberships(
    pool: &PgPool,
    provider_id: Uuid,
    user_id: Uuid,
    group_dns: &[String],
) -> Result<(), ApiError> {
    let mappings = sqlx::query_as::<_, LdapGroupMapping>(
        r#"
        SELECT id, provider_id, ldap_group_dn, organization_id, org_role, created_at
        FROM ldap_group_mappings
        WHERE provider_id = $1
        "#,
    )
    .bind(provider_id)
    .fetch_all(pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    for mapping in mappings {
        if !group_dns.iter().any(|dn| dn.eq_ignore_ascii_case(&mapping.ldap_group_dn)) {
            continue;
        }
        sqlx::query(
            r#"
            INSERT INTO organization_members (organization_id, user_id, role)
            VALUES ($1, $2, $3)
            ON CONFLICT (organization_id, user_id) DO UPDATE SET role = EXCLUDED.role
            "#,
        )
        .bind(mapping.organization_id)
        .bind(user_id)
        .bind(mapping.org_role)
        .execute(pool)
        .await
        .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;
    }

    Ok(())
}

pub async fn ensure_auth_admin(pool: &PgPool, user_id: Uuid) -> Result<(), ApiError> {
    let is_owner: bool = sqlx::query_scalar(
        r#"
        SELECT EXISTS(
            SELECT 1 FROM organization_members
            WHERE user_id = $1 AND role = 'owner'
        )
        "#,
    )
    .bind(user_id)
    .fetch_one(pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    if is_owner {
        return Ok(());
    }

    if let Ok(admins) = std::env::var("AUTH_ADMIN_USER_IDS") {
        let allowed: Vec<Uuid> = admins
            .split(',')
            .filter_map(|s| Uuid::parse_str(s.trim()).ok())
            .collect();
        if allowed.contains(&user_id) {
            return Ok(());
        }
    }

    Err(DomainError::Forbidden.into())
}

/// Set a random unusable password for users that need a non-null hash in legacy paths.
#[allow(dead_code)]
pub async fn set_random_password(pool: &PgPool, user_id: Uuid) -> Result<(), ApiError> {
    let random = random_token(24);
    let hash = hash_password(&random)
        .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;
    sqlx::query("UPDATE users SET password_hash = $1 WHERE id = $2")
        .bind(hash)
        .bind(user_id)
        .execute(pool)
        .await
        .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;
    Ok(())
}
