use std::path::Path;
use std::time::Instant;

use axum::{
    extract::{Path as AxumPath, Query, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use chrono::{DateTime, Utc};
use pertisk_domain::{models::*, DomainError};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;
use validator::Validate;

use crate::password::hash_password;
use crate::system_metrics::{self, HostMetrics, ProcessMetrics};
use crate::{ApiError, AppState, AuthUser};
use crate::version;

pub fn admin_routes() -> Router<AppState> {
    Router::new()
        .route("/admin/system", get(admin_system_info))
        .route("/admin/health", get(admin_health))
        .route("/admin/configuration", get(admin_configuration))
        .route("/admin/users", get(list_admin_users).post(create_admin_user))
        .route(
            "/admin/users/{user_id}",
            get(get_admin_user)
                .patch(update_admin_user)
                .delete(delete_admin_user),
        )
        .route("/admin/users/{user_id}/approve", post(approve_admin_user))
        .route("/admin/users/{user_id}/reject", post(reject_admin_user))
}

pub async fn is_super_admin(pool: &PgPool, user_id: Uuid) -> Result<bool, ApiError> {
    if let Ok(ids) = std::env::var("SUPER_ADMIN_USER_IDS") {
        let allowed: Vec<Uuid> = ids
            .split(',')
            .filter_map(|value| Uuid::parse_str(value.trim()).ok())
            .collect();
        if allowed.contains(&user_id) {
            return Ok(true);
        }
    }

    let flag = sqlx::query_scalar::<_, bool>(
        r#"SELECT is_super_admin FROM users WHERE id = $1"#,
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?
    .unwrap_or(false);

    Ok(flag)
}

pub async fn ensure_super_admin(pool: &PgPool, user_id: Uuid) -> Result<(), ApiError> {
    if is_super_admin(pool, user_id).await? {
        Ok(())
    } else {
        Err(DomainError::Forbidden.into())
    }
}

pub fn registration_enabled() -> bool {
    std::env::var("DISABLE_REGISTRATION")
        .map(|value| value != "1" && !value.eq_ignore_ascii_case("true"))
        .unwrap_or(true)
}

pub fn registration_requires_approval() -> bool {
    std::env::var("REQUIRE_REGISTRATION_APPROVAL")
        .map(|value| value != "0" && !value.eq_ignore_ascii_case("false"))
        .unwrap_or(true)
}

pub async fn ensure_user_approved(pool: &PgPool, user_id: Uuid) -> Result<(), ApiError> {
    if is_super_admin(pool, user_id).await? {
        return Ok(());
    }

    let status = sqlx::query_scalar::<_, UserApprovalStatus>(
        r#"SELECT approval_status FROM users WHERE id = $1"#,
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?
    .ok_or(DomainError::Unauthorized)?;

    match status {
        UserApprovalStatus::Approved => Ok(()),
        UserApprovalStatus::Pending => Err(DomainError::Validation(
            "account pending admin approval".into(),
        )
        .into()),
        UserApprovalStatus::Rejected => Err(DomainError::Validation(
            "account registration was rejected".into(),
        )
        .into()),
    }
}

pub fn ensure_user_record_approved(user: &User) -> Result<(), ApiError> {
    if user.is_super_admin {
        return Ok(());
    }

    match user.approval_status {
        UserApprovalStatus::Approved => Ok(()),
        UserApprovalStatus::Pending => Err(DomainError::Validation(
            "account pending admin approval".into(),
        )
        .into()),
        UserApprovalStatus::Rejected => Err(DomainError::Validation(
            "account registration was rejected".into(),
        )
        .into()),
    }
}

#[derive(Serialize)]
struct AdminSystemInfoResponse {
    version: &'static str,
    rust_version: String,
    started_at: DateTime<Utc>,
    counts: AdminSystemCounts,
    host: HostMetrics,
    process: ProcessMetrics,
    storage: AdminStorageInfo,
}

#[derive(Serialize)]
struct AdminSystemCounts {
    users: i64,
    pending_users: i64,
    organizations: i64,
    repositories: i64,
    pipeline_runs: i64,
    runners: i64,
}

#[derive(Serialize)]
struct AdminStorageInfo {
    repos_root: String,
    repos_root_exists: bool,
    repos_disk_bytes: u64,
    artifacts_root: String,
    artifacts_root_exists: bool,
    artifacts_count: i64,
    artifacts_db_bytes: i64,
    artifacts_disk_bytes: u64,
    registry_root: String,
    registry_root_exists: bool,
    registry_blob_count: i64,
    registry_db_bytes: i64,
    registry_disk_bytes: u64,
}

#[derive(Serialize)]
struct AdminHealthResponse {
    status: &'static str,
    version: &'static str,
    database: &'static str,
    database_latency_ms: u64,
    database_version: String,
    api_url: String,
    checked_at: DateTime<Utc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    s3: Option<pertisk_registry::storage::S3HealthReport>,
}

#[derive(Serialize)]
struct AdminConfigurationResponse {
    api_host: String,
    api_port: u16,
    git_public_base_url: String,
    git_ssh_public_host: Option<String>,
    git_ssh_port: Option<u16>,
    repos_root: String,
    artifacts_root: String,
    web_dist: Option<String>,
    registration_enabled: bool,
    require_registration_approval: bool,
    super_admin_env_override: bool,
}

#[derive(Serialize, sqlx::FromRow)]
struct AdminUserResponse {
    id: Uuid,
    username: String,
    email: String,
    display_name: Option<String>,
    is_super_admin: bool,
    has_password: bool,
    approval_status: UserApprovalStatus,
    approved_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
struct ListAdminUsersQuery {
    approval_status: Option<UserApprovalStatus>,
}

pub fn artifacts_root() -> String {
    std::env::var("ARTIFACTS_ROOT").unwrap_or_else(|_| "data/artifacts".into())
}

pub fn registry_root() -> String {
    std::env::var("REGISTRY_ROOT").unwrap_or_else(|_| "data/registry".into())
}

fn path_exists(path: &str) -> bool {
    Path::new(path).exists()
}

async fn admin_system_info(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<AdminSystemInfoResponse>, ApiError> {
    ensure_super_admin(&state.pool, auth.user_id).await?;

    let counts = sqlx::query_as::<_, (i64, i64, i64, i64, i64, i64)>(
        r#"
        SELECT
            (SELECT COUNT(*)::BIGINT FROM users),
            (SELECT COUNT(*)::BIGINT FROM users WHERE approval_status = 'pending'),
            (SELECT COUNT(*)::BIGINT FROM organizations),
            (SELECT COUNT(*)::BIGINT FROM repositories),
            (SELECT COUNT(*)::BIGINT FROM pipeline_runs),
            (SELECT COUNT(*)::BIGINT FROM runners)
        "#,
    )
    .fetch_one(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    let artifact_stats = sqlx::query_as::<_, (i64, i64)>(
        r#"
        SELECT
            COALESCE(SUM(size_bytes), 0)::BIGINT,
            COUNT(*)::BIGINT
        FROM job_artifacts
        "#,
    )
    .fetch_one(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    let registry_stats = sqlx::query_as::<_, (i64, i64)>(
        r#"
        SELECT
            COALESCE(SUM(size_bytes), 0)::BIGINT,
            COUNT(*)::BIGINT
        FROM container_blobs
        "#,
    )
    .fetch_one(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    let repos_root = state.config.repos_root.display().to_string();
    let artifacts_root = artifacts_root();
    let registry_root = registry_root();

    let repos_path = state.config.repos_root.clone();
    let artifacts_path = Path::new(&artifacts_root).to_path_buf();
    let registry_path = Path::new(&registry_root).to_path_buf();

    let (host, process, repos_disk_bytes, artifacts_disk_bytes, registry_disk_bytes) =
        tokio::task::spawn_blocking(move || {
            (
                system_metrics::collect_host_metrics(),
                system_metrics::collect_process_metrics(),
                system_metrics::directory_size_bytes(&repos_path),
                system_metrics::directory_size_bytes(&artifacts_path),
                system_metrics::directory_size_bytes(&registry_path),
            )
        })
        .await
        .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    Ok(Json(AdminSystemInfoResponse {
        version: version::APP_VERSION,
        rust_version: version::RUSTC_VERSION.to_string(),
        started_at: state.started_at,
        counts: AdminSystemCounts {
            users: counts.0,
            pending_users: counts.1,
            organizations: counts.2,
            repositories: counts.3,
            pipeline_runs: counts.4,
            runners: counts.5,
        },
        host,
        process,
        storage: AdminStorageInfo {
            repos_root_exists: state.config.repos_root.exists(),
            artifacts_root_exists: path_exists(&artifacts_root),
            registry_root_exists: path_exists(&registry_root),
            repos_root,
            artifacts_root,
            registry_root,
            repos_disk_bytes,
            artifacts_count: artifact_stats.1,
            artifacts_db_bytes: artifact_stats.0,
            artifacts_disk_bytes,
            registry_blob_count: registry_stats.1,
            registry_db_bytes: registry_stats.0,
            registry_disk_bytes,
        },
    }))
}

async fn admin_health(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<(StatusCode, Json<AdminHealthResponse>), ApiError> {
    ensure_super_admin(&state.pool, auth.user_id).await?;

    let started = Instant::now();
    let database = match sqlx::query("SELECT 1").execute(&state.pool).await {
        Ok(_) => "ok",
        Err(error) => {
            tracing::warn!(%error, "admin health check: database unavailable");
            "error"
        }
    };
    let database_latency_ms = started.elapsed().as_millis() as u64;

    let database_version = if database == "ok" {
        sqlx::query_scalar::<_, String>("SELECT version()")
            .fetch_one(&state.pool)
            .await
            .unwrap_or_else(|_| "unknown".into())
    } else {
        "unavailable".into()
    };

    let s3 = pertisk_registry::storage::check_s3_health().await;
    let healthy =
        database == "ok" && s3.as_ref().map(|report| report.status == "ok").unwrap_or(true);

    Ok((
        StatusCode::OK,
        Json(AdminHealthResponse {
            status: if healthy { "ok" } else { "unhealthy" },
            version: version::APP_VERSION,
            database,
            database_latency_ms,
            database_version,
            api_url: state.config.git_public_base_url.clone(),
            checked_at: Utc::now(),
            s3,
        }),
    ))
}

async fn admin_configuration(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<AdminConfigurationResponse>, ApiError> {
    ensure_super_admin(&state.pool, auth.user_id).await?;

    let registration_enabled = registration_enabled();
    let require_registration_approval = registration_requires_approval();

    Ok(Json(AdminConfigurationResponse {
        api_host: state.config.host.clone(),
        api_port: state.config.port,
        git_public_base_url: state.config.git_public_base_url.clone(),
        git_ssh_public_host: state.config.git_ssh_public_host.clone(),
        git_ssh_port: state.config.git_ssh_port,
        repos_root: state.config.repos_root.display().to_string(),
        artifacts_root: artifacts_root(),
        web_dist: state
            .config
            .web_dist
            .as_ref()
            .map(|path| path.display().to_string()),
        registration_enabled,
        require_registration_approval,
        super_admin_env_override: std::env::var("SUPER_ADMIN_USER_IDS").is_ok(),
    }))
}

async fn list_admin_users(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(query): Query<ListAdminUsersQuery>,
) -> Result<Json<Vec<AdminUserResponse>>, ApiError> {
    ensure_super_admin(&state.pool, auth.user_id).await?;

    let users = if let Some(status) = query.approval_status {
        sqlx::query_as::<_, AdminUserResponse>(
            r#"
            SELECT
                id,
                username,
                email,
                display_name,
                is_super_admin,
                (password_hash IS NOT NULL) AS has_password,
                approval_status,
                approved_at,
                created_at,
                updated_at
            FROM users
            WHERE approval_status = $1
            ORDER BY created_at DESC
            "#,
        )
        .bind(status)
        .fetch_all(&state.pool)
        .await
    } else {
        sqlx::query_as::<_, AdminUserResponse>(
            r#"
            SELECT
                id,
                username,
                email,
                display_name,
                is_super_admin,
                (password_hash IS NOT NULL) AS has_password,
                approval_status,
                approved_at,
                created_at,
                updated_at
            FROM users
            ORDER BY username
            "#,
        )
        .fetch_all(&state.pool)
        .await
    }
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    Ok(Json(users))
}

async fn get_admin_user(
    State(state): State<AppState>,
    auth: AuthUser,
    AxumPath(user_id): AxumPath<Uuid>,
) -> Result<Json<AdminUserResponse>, ApiError> {
    ensure_super_admin(&state.pool, auth.user_id).await?;
    fetch_admin_user(&state.pool, user_id).await
}

async fn create_admin_user(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(body): Json<AdminCreateUserRequest>,
) -> Result<(StatusCode, Json<AdminUserResponse>), ApiError> {
    body.validate()
        .map_err(|e| ApiError::from(DomainError::Validation(e.to_string())))?;
    ensure_super_admin(&state.pool, auth.user_id).await?;

    let password_hash = hash_password(&body.password)
        .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;
    let is_super_admin = body.is_super_admin.unwrap_or(false);

    let user_id = sqlx::query_scalar::<_, Uuid>(
        r#"
        INSERT INTO users (username, email, password_hash, display_name, is_super_admin, approval_status, approved_at, approved_by)
        VALUES ($1, $2, $3, $4, $5, 'approved', NOW(), $6)
        RETURNING id
        "#,
    )
    .bind(&body.username)
    .bind(&body.email)
    .bind(&password_hash)
    .bind(&body.display_name)
    .bind(is_super_admin)
    .bind(auth.user_id)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| match e {
        sqlx::Error::Database(db) if db.constraint().is_some() => {
            ApiError::from(DomainError::Conflict("username or email already exists".into()))
        }
        other => ApiError::from(DomainError::Internal(other.to_string())),
    })?;

    let user = fetch_admin_user(&state.pool, user_id).await?;
    Ok((StatusCode::CREATED, user))
}

async fn update_admin_user(
    State(state): State<AppState>,
    auth: AuthUser,
    AxumPath(user_id): AxumPath<Uuid>,
    Json(body): Json<AdminUpdateUserRequest>,
) -> Result<Json<AdminUserResponse>, ApiError> {
    body.validate()
        .map_err(|e| ApiError::from(DomainError::Validation(e.to_string())))?;
    ensure_super_admin(&state.pool, auth.user_id).await?;

    if body.username.is_none()
        && body.email.is_none()
        && body.password.is_none()
        && body.display_name.is_none()
        && body.is_super_admin.is_none()
    {
        return Err(DomainError::Validation("no fields to update".into()).into());
    }

    let existing = sqlx::query_as::<_, User>(
        r#"
        SELECT id, username, email, password_hash, display_name, is_super_admin, is_machine_user,
               approval_status, approved_at, approved_by, created_at, updated_at
        FROM users
        WHERE id = $1
        "#,
    )
    .bind(user_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?
    .ok_or(DomainError::NotFound)?;

    if body.is_super_admin == Some(false) && existing.is_super_admin {
        let super_admin_count: i64 = sqlx::query_scalar(
            r#"SELECT COUNT(*)::BIGINT FROM users WHERE is_super_admin = TRUE"#,
        )
        .fetch_one(&state.pool)
        .await
        .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;
        if super_admin_count <= 1 && !env_super_admin_ids_contains(user_id) {
            return Err(DomainError::Validation(
                "cannot remove the last super admin".into(),
            )
            .into());
        }
    }

    let username = body.username.unwrap_or(existing.username);
    let email = body.email.unwrap_or(existing.email);
    let display_name = match body.display_name {
        Some(value) => {
            if value.trim().is_empty() {
                None
            } else {
                Some(value)
            }
        }
        None => existing.display_name,
    };
    let is_super_admin = body.is_super_admin.unwrap_or(existing.is_super_admin);

    let password_hash = if let Some(password) = body.password {
        Some(
            hash_password(&password)
                .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?,
        )
    } else {
        existing.password_hash
    };

    sqlx::query(
        r#"
        UPDATE users
        SET username = $1,
            email = $2,
            display_name = $3,
            password_hash = $4,
            is_super_admin = $5,
            updated_at = NOW()
        WHERE id = $6
        "#,
    )
    .bind(&username)
    .bind(&email)
    .bind(&display_name)
    .bind(&password_hash)
    .bind(is_super_admin)
    .bind(user_id)
    .execute(&state.pool)
    .await
    .map_err(|e| match e {
        sqlx::Error::Database(db) if db.constraint().is_some() => {
            ApiError::from(DomainError::Conflict("username or email already exists".into()))
        }
        other => ApiError::from(DomainError::Internal(other.to_string())),
    })?;

    fetch_admin_user(&state.pool, user_id).await
}

async fn delete_admin_user(
    State(state): State<AppState>,
    auth: AuthUser,
    AxumPath(user_id): AxumPath<Uuid>,
) -> Result<StatusCode, ApiError> {
    ensure_super_admin(&state.pool, auth.user_id).await?;

    if user_id == auth.user_id {
        return Err(DomainError::Validation("cannot delete your own account".into()).into());
    }

    let existing = sqlx::query_as::<_, User>(
        r#"
        SELECT id, username, email, password_hash, display_name, is_super_admin, is_machine_user,
               approval_status, approved_at, approved_by, created_at, updated_at
        FROM users
        WHERE id = $1
        "#,
    )
    .bind(user_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?
    .ok_or(DomainError::NotFound)?;

    if existing.is_super_admin || env_super_admin_ids_contains(user_id) {
        let super_admin_count: i64 = sqlx::query_scalar(
            r#"SELECT COUNT(*)::BIGINT FROM users WHERE is_super_admin = TRUE"#,
        )
        .fetch_one(&state.pool)
        .await
        .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;
        let env_only = env_super_admin_ids_contains(user_id) && !existing.is_super_admin;
        if super_admin_count <= 1 && !env_only {
            return Err(DomainError::Validation(
                "cannot delete the last super admin".into(),
            )
            .into());
        }
    }

    let result = sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(user_id)
        .execute(&state.pool)
        .await
        .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    if result.rows_affected() == 0 {
        return Err(DomainError::NotFound.into());
    }

    Ok(StatusCode::NO_CONTENT)
}

async fn fetch_admin_user(pool: &PgPool, user_id: Uuid) -> Result<Json<AdminUserResponse>, ApiError> {
    sqlx::query_as::<_, AdminUserResponse>(
        r#"
        SELECT
            id,
            username,
            email,
            display_name,
            is_super_admin,
            (password_hash IS NOT NULL) AS has_password,
            approval_status,
            approved_at,
            created_at,
            updated_at
        FROM users
        WHERE id = $1
        "#,
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?
    .ok_or(DomainError::NotFound.into())
    .map(Json)
}

async fn approve_admin_user(
    State(state): State<AppState>,
    auth: AuthUser,
    AxumPath(user_id): AxumPath<Uuid>,
) -> Result<Json<AdminUserResponse>, ApiError> {
    ensure_super_admin(&state.pool, auth.user_id).await?;

    let result = sqlx::query(
        r#"
        UPDATE users
        SET approval_status = 'approved',
            approved_at = NOW(),
            approved_by = $1,
            updated_at = NOW()
        WHERE id = $2
          AND approval_status IN ('pending', 'rejected')
        "#,
    )
    .bind(auth.user_id)
    .bind(user_id)
    .execute(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    if result.rows_affected() == 0 {
        let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM users WHERE id = $1)")
            .bind(user_id)
            .fetch_one(&state.pool)
            .await
            .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;
        if !exists {
            return Err(DomainError::NotFound.into());
        }
        return Err(DomainError::Validation(
            "user is already approved".into(),
        )
        .into());
    }

    crate::notifications::notify_user_approved(
        state.pool.clone(),
        state.secrets_crypto.clone(),
        state.config.git_public_base_url.clone(),
        user_id,
    );

    fetch_admin_user(&state.pool, user_id).await
}

async fn reject_admin_user(
    State(state): State<AppState>,
    auth: AuthUser,
    AxumPath(user_id): AxumPath<Uuid>,
) -> Result<Json<AdminUserResponse>, ApiError> {
    ensure_super_admin(&state.pool, auth.user_id).await?;

    if user_id == auth.user_id {
        return Err(DomainError::Validation("cannot reject your own account".into()).into());
    }

    let existing = sqlx::query_as::<_, User>(
        r#"
        SELECT id, username, email, password_hash, display_name, is_super_admin, is_machine_user,
               approval_status, approved_at, approved_by, created_at, updated_at
        FROM users
        WHERE id = $1
        "#,
    )
    .bind(user_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?
    .ok_or(DomainError::NotFound)?;

    if existing.is_super_admin || env_super_admin_ids_contains(user_id) {
        return Err(DomainError::Validation("cannot reject a super admin".into()).into());
    }

    if existing.approval_status != UserApprovalStatus::Pending {
        return Err(DomainError::Validation(
            "only pending registrations can be rejected".into(),
        )
        .into());
    }

    sqlx::query(
        r#"
        UPDATE users
        SET approval_status = 'rejected',
            approved_at = NULL,
            approved_by = NULL,
            updated_at = NOW()
        WHERE id = $1
        "#,
    )
    .bind(user_id)
    .execute(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    fetch_admin_user(&state.pool, user_id).await
}

fn env_super_admin_ids_contains(user_id: Uuid) -> bool {
    std::env::var("SUPER_ADMIN_USER_IDS")
        .ok()
        .map(|value| {
            value
                .split(',')
                .filter_map(|part| Uuid::parse_str(part.trim()).ok())
                .any(|id| id == user_id)
        })
        .unwrap_or(false)
}
