use std::sync::{Arc, OnceLock};

use axum::{
    extract::State,
    routing::{get, post},
    Json, Router,
};
use lettre::message::header::ContentType;
use lettre::message::Mailbox;
use lettre::transport::smtp::authentication::Credentials;
use lettre::{AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor};
use pertisk_domain::DomainError;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;
use validator::Validate;

use crate::secrets_crypto::SecretsCrypto;
use crate::{admin, ApiError, AppState, AuthUser};

pub struct NotificationContext {
    pub secrets_crypto: Arc<SecretsCrypto>,
    pub base_url: String,
}

static NOTIFICATION_CTX: OnceLock<NotificationContext> = OnceLock::new();

pub fn init_notification_context(ctx: NotificationContext) {
    let _ = NOTIFICATION_CTX.set(ctx);
}

fn notification_context() -> Option<&'static NotificationContext> {
    NOTIFICATION_CTX.get()
}

pub fn notification_routes() -> Router<AppState> {
    Router::new()
        .route(
            "/admin/notifications/smtp",
            get(get_smtp_settings).put(update_smtp_settings),
        )
        .route(
            "/admin/notifications/smtp/test",
            post(test_smtp_settings),
        )
}

#[derive(Debug, Clone, sqlx::FromRow)]
struct SmtpSettingsRow {
    enabled: bool,
    host: String,
    port: i32,
    username: Option<String>,
    password_encrypted: Option<Vec<u8>>,
    from_email: String,
    from_name: String,
    use_tls: bool,
    notify_login: bool,
    notify_user_registration: bool,
    notify_user_approval: bool,
    notify_merge_request: bool,
    notify_pipeline_failure: bool,
}

#[derive(Serialize)]
pub struct SmtpSettingsResponse {
    enabled: bool,
    host: String,
    port: i32,
    username: Option<String>,
    has_password: bool,
    from_email: String,
    from_name: String,
    use_tls: bool,
    notify_login: bool,
    notify_user_registration: bool,
    notify_user_approval: bool,
    notify_merge_request: bool,
    notify_pipeline_failure: bool,
}

#[derive(Deserialize, Validate)]
pub struct UpdateSmtpSettingsRequest {
    pub enabled: Option<bool>,
    #[validate(length(max = 255))]
    pub host: Option<String>,
    pub port: Option<i32>,
    #[validate(length(max = 255))]
    pub username: Option<String>,
    /// Empty string clears password; omitted leaves unchanged.
    pub password: Option<String>,
    #[validate(email)]
    pub from_email: Option<String>,
    #[validate(length(max = 255))]
    pub from_name: Option<String>,
    pub use_tls: Option<bool>,
    pub notify_login: Option<bool>,
    pub notify_user_registration: Option<bool>,
    pub notify_user_approval: Option<bool>,
    pub notify_merge_request: Option<bool>,
    pub notify_pipeline_failure: Option<bool>,
}

#[derive(Deserialize)]
struct TestSmtpRequest {
    #[serde(default)]
    to: Option<String>,
}

async fn get_smtp_settings(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<SmtpSettingsResponse>, ApiError> {
    admin::ensure_super_admin(&state.pool, auth.user_id).await?;
    let row = load_smtp_row(&state.pool).await?;
    Ok(Json(row_to_response(&row)))
}

async fn update_smtp_settings(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(body): Json<UpdateSmtpSettingsRequest>,
) -> Result<Json<SmtpSettingsResponse>, ApiError> {
    admin::ensure_super_admin(&state.pool, auth.user_id).await?;
    body.validate()
        .map_err(|e| ApiError::from(DomainError::Validation(e.to_string())))?;

    let mut row = load_smtp_row(&state.pool).await?;

    if let Some(enabled) = body.enabled {
        row.enabled = enabled;
    }
    if let Some(host) = body.host {
        row.host = host.trim().to_string();
    }
    if let Some(port) = body.port {
        if !(1..=65535).contains(&port) {
            return Err(DomainError::Validation("port must be between 1 and 65535".into()).into());
        }
        row.port = port;
    }
    if let Some(username) = body.username {
        let trimmed = username.trim().to_string();
        row.username = if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        };
    }
    if let Some(password) = body.password {
        if password.is_empty() {
            row.password_encrypted = None;
        } else {
            row.password_encrypted = Some(
                state
                    .secrets_crypto
                    .encrypt(&password)
                    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?,
            );
        }
    }
    if let Some(from_email) = body.from_email {
        row.from_email = from_email.trim().to_string();
    }
    if let Some(from_name) = body.from_name {
        row.from_name = from_name.trim().to_string();
    }
    if let Some(use_tls) = body.use_tls {
        row.use_tls = use_tls;
    }
    if let Some(notify_login) = body.notify_login {
        row.notify_login = notify_login;
    }
    if let Some(notify_user_registration) = body.notify_user_registration {
        row.notify_user_registration = notify_user_registration;
    }
    if let Some(notify_user_approval) = body.notify_user_approval {
        row.notify_user_approval = notify_user_approval;
    }
    if let Some(notify_merge_request) = body.notify_merge_request {
        row.notify_merge_request = notify_merge_request;
    }
    if let Some(notify_pipeline_failure) = body.notify_pipeline_failure {
        row.notify_pipeline_failure = notify_pipeline_failure;
    }

    sqlx::query(
        r#"
        UPDATE smtp_settings SET
            enabled = $1,
            host = $2,
            port = $3,
            username = $4,
            password_encrypted = $5,
            from_email = $6,
            from_name = $7,
            use_tls = $8,
            notify_login = $9,
            notify_user_registration = $10,
            notify_user_approval = $11,
            notify_merge_request = $12,
            notify_pipeline_failure = $13,
            updated_at = NOW()
        WHERE id = 1
        "#,
    )
    .bind(row.enabled)
    .bind(&row.host)
    .bind(row.port)
    .bind(&row.username)
    .bind(&row.password_encrypted)
    .bind(&row.from_email)
    .bind(&row.from_name)
    .bind(row.use_tls)
    .bind(row.notify_login)
    .bind(row.notify_user_registration)
    .bind(row.notify_user_approval)
    .bind(row.notify_merge_request)
    .bind(row.notify_pipeline_failure)
    .execute(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    Ok(Json(row_to_response(&row)))
}

async fn test_smtp_settings(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(body): Json<TestSmtpRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    admin::ensure_super_admin(&state.pool, auth.user_id).await?;

    let to = if let Some(to) = body.to.filter(|v| !v.trim().is_empty()) {
        to
    } else {
        sqlx::query_scalar::<_, String>("SELECT email FROM users WHERE id = $1")
            .bind(auth.user_id)
            .fetch_one(&state.pool)
            .await
            .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?
    };

    send_email(
        &state.pool,
        &state.secrets_crypto,
        &to,
        "Pertisk Gits SMTP test",
        "This is a test email from your Pertisk Gits instance. SMTP is configured correctly.",
        false,
    )
    .await
    .map_err(|e| ApiError::from(DomainError::Validation(e.to_string())))?;

    Ok(Json(serde_json::json!({ "ok": true, "to": to })))
}

fn row_to_response(row: &SmtpSettingsRow) -> SmtpSettingsResponse {
    SmtpSettingsResponse {
        enabled: row.enabled,
        host: row.host.clone(),
        port: row.port,
        username: row.username.clone(),
        has_password: row.password_encrypted.is_some(),
        from_email: row.from_email.clone(),
        from_name: row.from_name.clone(),
        use_tls: row.use_tls,
        notify_login: row.notify_login,
        notify_user_registration: row.notify_user_registration,
        notify_user_approval: row.notify_user_approval,
        notify_merge_request: row.notify_merge_request,
        notify_pipeline_failure: row.notify_pipeline_failure,
    }
}

async fn load_smtp_row_internal(pool: &PgPool) -> Result<SmtpSettingsRow, anyhow::Error> {
    sqlx::query_as::<_, SmtpSettingsRow>(
        r#"
        SELECT enabled, host, port, username, password_encrypted, from_email, from_name, use_tls,
               notify_login, notify_user_registration, notify_user_approval,
               notify_merge_request, notify_pipeline_failure
        FROM smtp_settings
        WHERE id = 1
        "#,
    )
    .fetch_one(pool)
    .await
    .map_err(|e| anyhow::anyhow!("load smtp settings: {e}"))
}

async fn load_smtp_row(pool: &PgPool) -> Result<SmtpSettingsRow, ApiError> {
    load_smtp_row_internal(pool)
        .await
        .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))
}

async fn send_email(
    pool: &PgPool,
    crypto: &SecretsCrypto,
    to: &str,
    subject: &str,
    body: &str,
    require_enabled: bool,
) -> Result<(), anyhow::Error> {
    let settings = load_smtp_row_internal(pool).await?;
    if require_enabled && !settings.enabled {
        anyhow::bail!("SMTP is disabled");
    }
    if settings.host.trim().is_empty() {
        anyhow::bail!("SMTP host is not configured");
    }
    if settings.from_email.trim().is_empty() {
        anyhow::bail!("From email is not configured");
    }

    let from_mailbox = Mailbox::new(
        if settings.from_name.trim().is_empty() {
            None
        } else {
            Some(settings.from_name.clone())
        },
        settings.from_email.parse()?,
    );
    let to_mailbox = to
        .parse()
        .map_err(|e| anyhow::anyhow!("invalid recipient {to}: {e}"))?;

    let email = Message::builder()
        .from(from_mailbox)
        .to(to_mailbox)
        .subject(subject)
        .header(ContentType::TEXT_PLAIN)
        .body(body.to_string())?;

    let password = if let Some(blob) = &settings.password_encrypted {
        Some(crypto.decrypt(blob)?)
    } else {
        None
    };

    if settings.username.as_ref().is_some_and(|u| !u.is_empty()) && password.is_none() {
        anyhow::bail!("SMTP username is set but password is missing");
    }

    tracing::info!(
        host = %settings.host,
        port = settings.port,
        use_tls = settings.use_tls,
        to = %to,
        "sending email"
    );

    let mailer = build_mailer(&settings, password.as_deref())?;
    mailer.send(email).await.map_err(|err| {
        anyhow::anyhow!("SMTP send to {to} failed: {err}")
    })?;
    tracing::info!(to = %to, "email sent");
    Ok(())
}

fn build_mailer(
    settings: &SmtpSettingsRow,
    password: Option<&str>,
) -> Result<AsyncSmtpTransport<Tokio1Executor>, anyhow::Error> {
    let host = settings.host.trim();
    let port = settings.port as u16;

    let mut builder = if !settings.use_tls {
        AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(host)
    } else if port == 465 {
        AsyncSmtpTransport::<Tokio1Executor>::relay(host)?
    } else {
        AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(host)?
    };
    builder = builder.port(port);

    if let Some(username) = settings.username.as_ref().filter(|u| !u.is_empty()) {
        let pass = password.ok_or_else(|| {
            anyhow::anyhow!("SMTP password is required when username is configured")
        })?;
        builder = builder.credentials(Credentials::new(username.clone(), pass.to_string()));
    }

    Ok(builder.build())
}

async fn should_send(pool: &PgPool, flag: fn(&SmtpSettingsRow) -> bool) -> bool {
    match load_smtp_row_internal(pool).await {
        Ok(row) => {
            if !row.enabled {
                tracing::debug!("smtp notifications skipped: SMTP is disabled");
                return false;
            }
            if !flag(&row) {
                tracing::debug!("smtp notifications skipped: event toggle disabled");
                return false;
            }
            true
        }
        Err(err) => {
            tracing::warn!("{err:#}");
            false
        }
    }
}

pub fn notify_login(pool: PgPool, crypto: Arc<SecretsCrypto>, user_id: Uuid, method: &str) {
    let method = method.to_string();
    tokio::spawn(async move {
        if !should_send(&pool, |s| s.notify_login).await {
            return;
        }
        let Ok(email) = sqlx::query_scalar::<_, String>("SELECT email FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_one(&pool)
            .await
        else {
            return;
        };
        let subject = "New sign-in to Pertisk Gits";
        let body = format!(
            "Your account was used to sign in via {method}.\n\nIf this was not you, change your password immediately."
        );
        if let Err(err) = send_email(&pool, &crypto, &email, subject, &body, true).await {
            tracing::warn!("login notification email to {email} failed: {err:#}");
        }
    });
}

pub fn notify_user_registered(
    pool: PgPool,
    crypto: Arc<SecretsCrypto>,
    base_url: String,
    user_id: Uuid,
    pending_approval: bool,
) {
    tokio::spawn(async move {
        if !should_send(&pool, |s| s.notify_user_registration).await {
            return;
        }

        let Ok((username, email)) = sqlx::query_as::<_, (String, String)>(
            "SELECT username, email FROM users WHERE id = $1",
        )
        .bind(user_id)
        .fetch_one(&pool)
        .await
        else {
            return;
        };

        let login_url = format!("{base_url}/login");
        let (subject, body) = if pending_approval {
            (
                "Pertisk Gits registration received",
                format!(
                    "Hi @{username},\n\nYour account was created and is awaiting administrator approval.\nYou will receive another email when your account is approved.\n\nSign in after approval: {login_url}"
                ),
            )
        } else {
            (
                "Welcome to Pertisk Gits",
                format!(
                    "Hi @{username},\n\nYour account was created successfully.\n\nSign in: {login_url}"
                ),
            )
        };

        if let Err(err) = send_email(&pool, &crypto, &email, subject, &body, true).await {
            tracing::warn!("registration email to {email} failed: {err:#}");
        }

        if !pending_approval {
            return;
        }

        let admin_url = format!("{base_url}/admin/users");
        let admin_subject = "New user registration pending approval";
        let admin_body = format!(
            "User @{username} ({email}) registered and is awaiting approval.\n\nReview: {admin_url}"
        );
        for admin_email in super_admin_emails(&pool).await {
            if admin_email == email {
                continue;
            }
            if let Err(err) = send_email(&pool, &crypto, &admin_email, admin_subject, &admin_body, true).await
            {
                tracing::warn!("registration admin email to {admin_email} failed: {err:#}");
            }
        }
    });
}

pub fn notify_user_approved(
    pool: PgPool,
    crypto: Arc<SecretsCrypto>,
    base_url: String,
    user_id: Uuid,
) {
    tokio::spawn(async move {
        if !should_send(&pool, |s| s.notify_user_approval).await {
            return;
        }

        let Ok((username, email)) = sqlx::query_as::<_, (String, String)>(
            "SELECT username, email FROM users WHERE id = $1",
        )
        .bind(user_id)
        .fetch_one(&pool)
        .await
        else {
            return;
        };

        let login_url = format!("{base_url}/login");
        let subject = "Your Pertisk Gits account was approved";
        let body = format!(
            "Hi @{username},\n\nYour account has been approved. You can now sign in.\n\nSign in: {login_url}"
        );
        if let Err(err) = send_email(&pool, &crypto, &email, subject, &body, true).await {
            tracing::warn!("approval email to {email} failed: {err:#}");
        }
    });
}

pub fn notify_pull_request_opened(
    pool: PgPool,
    crypto: Arc<SecretsCrypto>,
    base_url: String,
    org_path: String,
    repo_slug: String,
    pull_number: i32,
    title: &str,
    author_id: Uuid,
    repository_id: Uuid,
) {
    let title = title.to_string();
    tokio::spawn(async move {
        if !should_send(&pool, |s| s.notify_merge_request).await {
            return;
        }
        let recipients =
            repo_collaborator_emails(&pool, repository_id, Some(author_id)).await;
        if recipients.is_empty() {
            return;
        }
        let url = format!("{base_url}/groups/{org_path}/projects/{repo_slug}/pulls/{pull_number}");
        let subject = format!("[{repo_slug}] New pull request #{pull_number}");
        let body = format!("Pull request #{pull_number} opened: {title}\n\nView: {url}");
        for email in recipients {
            if let Err(err) = send_email(&pool, &crypto, &email, &subject, &body, true).await {
                tracing::warn!("pull request opened email to {email} failed: {err:#}");
            }
        }
    });
}

pub fn notify_pull_request_merged(
    pool: PgPool,
    crypto: Arc<SecretsCrypto>,
    base_url: String,
    org_path: String,
    repo_slug: String,
    pull_number: i32,
    title: &str,
    author_id: Uuid,
    merged_by: Uuid,
) {
    let title = title.to_string();
    tokio::spawn(async move {
        if !should_send(&pool, |s| s.notify_merge_request).await {
            return;
        }
        let Ok(author_email) =
            sqlx::query_scalar::<_, String>("SELECT email FROM users WHERE id = $1")
                .bind(author_id)
                .fetch_one(&pool)
                .await
        else {
            return;
        };
        let merger = sqlx::query_scalar::<_, String>("SELECT username FROM users WHERE id = $1")
            .bind(merged_by)
            .fetch_optional(&pool)
            .await
            .ok()
            .flatten()
            .unwrap_or_else(|| "someone".to_string());

        let url = format!("{base_url}/groups/{org_path}/projects/{repo_slug}/pulls/{pull_number}");
        let subject = format!("[{repo_slug}] Pull request #{pull_number} merged");
        let body = format!(
            "Pull request #{pull_number} was merged by @{merger}: {title}\n\nView: {url}"
        );
        if let Err(err) = send_email(&pool, &crypto, &author_email, &subject, &body, true).await {
            tracing::warn!("pull request merged email to {author_email} failed: {err:#}");
        }
    });
}

pub fn notify_pipeline_failed(pool: PgPool, pipeline_run_id: Uuid) {
    let Some(ctx) = notification_context() else {
        return;
    };
    let crypto = ctx.secrets_crypto.clone();
    let base_url = ctx.base_url.clone();

    tokio::spawn(async move {
        if !should_send(&pool, |s| s.notify_pipeline_failure).await {
            return;
        }

        let Ok(Some(row)) = sqlx::query_as::<_, (Uuid, String, String, String, Option<i32>)>(
            r#"
            SELECT run.repository_id, o.full_path, r.slug, run.ref_name, run.pull_request_number
            FROM pipeline_runs run
            INNER JOIN repositories r ON r.id = run.repository_id
            INNER JOIN organizations o ON o.id = r.organization_id
            WHERE run.id = $1
            "#,
        )
        .bind(pipeline_run_id)
        .fetch_optional(&pool)
        .await
        else {
            return;
        };

        let (repository_id, org_path, repo_slug, ref_name, pr_number) = row;

        let commit_sha = sqlx::query_scalar::<_, String>(
            "SELECT commit_sha FROM pipeline_runs WHERE id = $1",
        )
        .bind(pipeline_run_id)
        .fetch_optional(&pool)
        .await
        .ok()
        .flatten()
        .unwrap_or_default();

        let failed_jobs: Vec<String> = sqlx::query_scalar(
            r#"
            SELECT job_name FROM job_runs
            WHERE pipeline_run_id = $1 AND status = 'failure'
            ORDER BY queued_at
            "#,
        )
        .bind(pipeline_run_id)
        .fetch_all(&pool)
        .await
        .unwrap_or_default();

        let recipients = if let Some(pr_number) = pr_number {
            let author_id = sqlx::query_scalar::<_, Option<Uuid>>(
                r#"
                SELECT author_id FROM pull_requests
                WHERE repository_id = $1 AND number = $2
                "#,
            )
            .bind(repository_id)
            .bind(pr_number)
            .fetch_optional(&pool)
            .await
            .ok()
            .flatten()
            .flatten();
            if let Some(author_id) = author_id {
                if let Ok(email) = sqlx::query_scalar::<_, String>(
                    "SELECT email FROM users WHERE id = $1",
                )
                .bind(author_id)
                .fetch_one(&pool)
                .await
                {
                    vec![email]
                } else {
                    vec![]
                }
            } else {
                vec![]
            }
        } else {
            repo_collaborator_emails(&pool, repository_id, None).await
        };

        if recipients.is_empty() {
            return;
        }

        let short_sha = if commit_sha.len() >= 7 {
            &commit_sha[..7]
        } else {
            &commit_sha
        };
        let run_url =
            format!("{base_url}/groups/{org_path}/projects/{repo_slug}/pipelines/{pipeline_run_id}");
        let jobs = if failed_jobs.is_empty() {
            "unknown".to_string()
        } else {
            failed_jobs.join(", ")
        };
        let subject = format!("[{repo_slug}] Pipeline failed on {ref_name}");
        let body = format!(
            "Pipeline failed for commit {short_sha} on {ref_name}.\nFailed jobs: {jobs}\n\nView run: {run_url}"
        );

        for email in recipients {
            if let Err(err) = send_email(&pool, &crypto, &email, &subject, &body, true).await {
                tracing::warn!("pipeline failure email to {email} failed: {err:#}");
            }
        }
    });
}

async fn repo_collaborator_emails(
    pool: &PgPool,
    repository_id: Uuid,
    exclude_user_id: Option<Uuid>,
) -> Vec<String> {
    sqlx::query_scalar(
        r#"
        SELECT DISTINCT u.email
        FROM repository_permissions rp
        INNER JOIN users u ON u.id = rp.user_id
        WHERE rp.repository_id = $1
          AND rp.role IN ('admin', 'write')
          AND ($2::uuid IS NULL OR u.id <> $2)
        "#,
    )
    .bind(repository_id)
    .bind(exclude_user_id)
    .fetch_all(pool)
    .await
    .unwrap_or_default()
}

async fn super_admin_emails(pool: &PgPool) -> Vec<String> {
    let mut emails: Vec<String> = sqlx::query_scalar(
        r#"
        SELECT email FROM users
        WHERE is_super_admin = TRUE
        ORDER BY email
        "#,
    )
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    if let Ok(ids) = std::env::var("SUPER_ADMIN_USER_IDS") {
        for id in ids.split(',').filter_map(|part| Uuid::parse_str(part.trim()).ok()) {
            if let Ok(email) = sqlx::query_scalar::<_, String>(
                "SELECT email FROM users WHERE id = $1",
            )
            .bind(id)
            .fetch_optional(pool)
            .await
            {
                if let Some(email) = email {
                    if !emails.iter().any(|e| e == &email) {
                        emails.push(email);
                    }
                }
            }
        }
    }

    emails
}
