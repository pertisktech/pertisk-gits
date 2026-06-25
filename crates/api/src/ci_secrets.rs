use std::collections::HashMap;

use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{get, patch, post},
    Json, Router,
};
use chrono::{DateTime, Utc};
use pertisk_domain::DomainError;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

use crate::permissions::{ensure_can_admin_repo, ensure_can_manage_org};
use crate::secrets_crypto::SecretsCrypto;
use crate::{find_org_for_member, ApiError, AppState, AuthUser};

pub fn ci_secrets_read_routes() -> Router<AppState> {
    Router::new()
        .route("/organizations/{org_slug}/secrets", get(list_org_secrets))
        .route(
            "/organizations/{org_slug}/repositories/{repo_slug}/secrets",
            get(list_repo_secrets),
        )
}

pub fn ci_secrets_write_routes() -> Router<AppState> {
    Router::new()
        .route("/organizations/{org_slug}/secrets", post(create_org_secret))
        .route(
            "/organizations/{org_slug}/secrets/{secret_id}",
            patch(update_org_secret).delete(delete_org_secret),
        )
        .route(
            "/organizations/{org_slug}/repositories/{repo_slug}/secrets",
            post(create_repo_secret),
        )
        .route(
            "/organizations/{org_slug}/repositories/{repo_slug}/secrets/{secret_id}",
            patch(update_repo_secret).delete(delete_repo_secret),
        )
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "ci_secret_kind", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum CiSecretKind {
    Variable,
    File,
}

#[derive(Serialize)]
struct CiSecretSummary {
    id: Uuid,
    name: String,
    secret_kind: CiSecretKind,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

#[derive(Deserialize)]
struct UpsertSecretRequest {
    name: String,
    secret_kind: Option<CiSecretKind>,
    value: String,
}

#[derive(Deserialize)]
struct UpdateSecretRequest {
    secret_kind: Option<CiSecretKind>,
    value: Option<String>,
}

#[derive(Serialize)]
pub struct RunnerJobSecret {
    pub name: String,
    pub secret_kind: CiSecretKind,
    pub value: String,
}

#[derive(Serialize)]
pub struct RunnerJobSecretsResponse {
    pub secrets: Vec<RunnerJobSecret>,
}

async fn list_org_secrets(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(org_slug): Path<String>,
) -> Result<Json<Vec<CiSecretSummary>>, ApiError> {
    let org = find_org_for_member(&state.pool, &org_slug, auth.user_id).await?;
    ensure_can_manage_org(&state.pool, org.id, auth.user_id).await?;

    let rows = sqlx::query_as::<_, (Uuid, String, CiSecretKind, DateTime<Utc>, DateTime<Utc>)>(
        r#"
        SELECT id, name, secret_kind, created_at, updated_at
        FROM organization_secrets
        WHERE organization_id = $1
        ORDER BY name ASC
        "#,
    )
    .bind(org.id)
    .fetch_all(&state.pool)
    .await
    .map_err(sqlx_error)?;

    Ok(Json(
        rows.into_iter()
            .map(|(id, name, secret_kind, created_at, updated_at)| CiSecretSummary {
                id,
                name,
                secret_kind,
                created_at,
                updated_at,
            })
            .collect(),
    ))
}

async fn create_org_secret(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(org_slug): Path<String>,
    Json(body): Json<UpsertSecretRequest>,
) -> Result<(StatusCode, Json<CiSecretSummary>), ApiError> {
    let org = find_org_for_member(&state.pool, &org_slug, auth.user_id).await?;
    ensure_can_manage_org(&state.pool, org.id, auth.user_id).await?;
    let name = normalize_secret_name(&body.name)?;
    let kind = body.secret_kind.unwrap_or(CiSecretKind::Variable);
    let encrypted = state
        .secrets_crypto
        .encrypt(&body.value)
        .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    let row = sqlx::query_as::<_, (Uuid, String, CiSecretKind, DateTime<Utc>, DateTime<Utc>)>(
        r#"
        INSERT INTO organization_secrets (organization_id, name, secret_kind, encrypted_value, created_by)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, name, secret_kind, created_at, updated_at
        "#,
    )
    .bind(org.id)
    .bind(&name)
    .bind(kind)
    .bind(&encrypted)
    .bind(auth.user_id)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| {
        if let sqlx::Error::Database(db) = &e {
            if db.constraint() == Some("organization_secrets_organization_id_name_key") {
                return ApiError::from(DomainError::Validation(format!(
                    "secret {name} already exists at group level"
                )));
            }
        }
        sqlx_error(e)
    })?;

    Ok((
        StatusCode::CREATED,
        Json(CiSecretSummary {
            id: row.0,
            name: row.1,
            secret_kind: row.2,
            created_at: row.3,
            updated_at: row.4,
        }),
    ))
}

async fn update_org_secret(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_slug, secret_id)): Path<(String, Uuid)>,
    Json(body): Json<UpdateSecretRequest>,
) -> Result<Json<CiSecretSummary>, ApiError> {
    let org = find_org_for_member(&state.pool, &org_slug, auth.user_id).await?;
    ensure_can_manage_org(&state.pool, org.id, auth.user_id).await?;

    let existing = sqlx::query_as::<_, (CiSecretKind,)>(
        "SELECT secret_kind FROM organization_secrets WHERE id = $1 AND organization_id = $2",
    )
    .bind(secret_id)
    .bind(org.id)
    .fetch_optional(&state.pool)
    .await
    .map_err(sqlx_error)?
    .ok_or(DomainError::NotFound)?;

    let kind = body.secret_kind.unwrap_or(existing.0);
    if let Some(value) = &body.value {
        let encrypted = state
            .secrets_crypto
            .encrypt(value)
            .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;
        sqlx::query(
            r#"
            UPDATE organization_secrets
            SET secret_kind = $3, encrypted_value = $4, updated_at = NOW()
            WHERE id = $1 AND organization_id = $2
            "#,
        )
        .bind(secret_id)
        .bind(org.id)
        .bind(kind)
        .bind(&encrypted)
        .execute(&state.pool)
        .await
        .map_err(sqlx_error)?;
    } else if body.secret_kind.is_some() {
        sqlx::query(
            "UPDATE organization_secrets SET secret_kind = $3, updated_at = NOW() WHERE id = $1 AND organization_id = $2",
        )
        .bind(secret_id)
        .bind(org.id)
        .bind(kind)
        .execute(&state.pool)
        .await
        .map_err(sqlx_error)?;
    }

    fetch_org_secret_summary(&state.pool, org.id, secret_id).await
}

async fn delete_org_secret(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_slug, secret_id)): Path<(String, Uuid)>,
) -> Result<StatusCode, ApiError> {
    let org = find_org_for_member(&state.pool, &org_slug, auth.user_id).await?;
    ensure_can_manage_org(&state.pool, org.id, auth.user_id).await?;

    let result = sqlx::query("DELETE FROM organization_secrets WHERE id = $1 AND organization_id = $2")
        .bind(secret_id)
        .bind(org.id)
        .execute(&state.pool)
        .await
        .map_err(sqlx_error)?;

    if result.rows_affected() == 0 {
        return Err(DomainError::NotFound.into());
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn list_repo_secrets(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_slug, repo_slug)): Path<(String, String)>,
) -> Result<Json<Vec<CiSecretSummary>>, ApiError> {
    let org = find_org_for_member(&state.pool, &org_slug, auth.user_id).await?;
    let repo = find_repo_in_org(&state.pool, org.id, &repo_slug).await?;
    ensure_can_admin_repo(&state.pool, org.id, &repo, &auth).await?;

    let rows = sqlx::query_as::<_, (Uuid, String, CiSecretKind, DateTime<Utc>, DateTime<Utc>)>(
        r#"
        SELECT id, name, secret_kind, created_at, updated_at
        FROM repository_secrets
        WHERE repository_id = $1
        ORDER BY name ASC
        "#,
    )
    .bind(repo.id)
    .fetch_all(&state.pool)
    .await
    .map_err(sqlx_error)?;

    Ok(Json(
        rows.into_iter()
            .map(|(id, name, secret_kind, created_at, updated_at)| CiSecretSummary {
                id,
                name,
                secret_kind,
                created_at,
                updated_at,
            })
            .collect(),
    ))
}

async fn create_repo_secret(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_slug, repo_slug)): Path<(String, String)>,
    Json(body): Json<UpsertSecretRequest>,
) -> Result<(StatusCode, Json<CiSecretSummary>), ApiError> {
    let org = find_org_for_member(&state.pool, &org_slug, auth.user_id).await?;
    let repo = find_repo_in_org(&state.pool, org.id, &repo_slug).await?;
    ensure_can_admin_repo(&state.pool, org.id, &repo, &auth).await?;
    let name = normalize_secret_name(&body.name)?;
    let kind = body.secret_kind.unwrap_or(CiSecretKind::Variable);
    let encrypted = state
        .secrets_crypto
        .encrypt(&body.value)
        .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    let row = sqlx::query_as::<_, (Uuid, String, CiSecretKind, DateTime<Utc>, DateTime<Utc>)>(
        r#"
        INSERT INTO repository_secrets (repository_id, name, secret_kind, encrypted_value, created_by)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, name, secret_kind, created_at, updated_at
        "#,
    )
    .bind(repo.id)
    .bind(&name)
    .bind(kind)
    .bind(&encrypted)
    .bind(auth.user_id)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| {
        if let sqlx::Error::Database(db) = &e {
            if db.constraint() == Some("repository_secrets_repository_id_name_key") {
                return ApiError::from(DomainError::Validation(format!(
                    "secret {name} already exists for this repository"
                )));
            }
        }
        sqlx_error(e)
    })?;

    Ok((
        StatusCode::CREATED,
        Json(CiSecretSummary {
            id: row.0,
            name: row.1,
            secret_kind: row.2,
            created_at: row.3,
            updated_at: row.4,
        }),
    ))
}

async fn update_repo_secret(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_slug, repo_slug, secret_id)): Path<(String, String, Uuid)>,
    Json(body): Json<UpdateSecretRequest>,
) -> Result<Json<CiSecretSummary>, ApiError> {
    let org = find_org_for_member(&state.pool, &org_slug, auth.user_id).await?;
    let repo = find_repo_in_org(&state.pool, org.id, &repo_slug).await?;
    ensure_can_admin_repo(&state.pool, org.id, &repo, &auth).await?;

    let existing = sqlx::query_as::<_, (CiSecretKind,)>(
        "SELECT secret_kind FROM repository_secrets WHERE id = $1 AND repository_id = $2",
    )
    .bind(secret_id)
    .bind(repo.id)
    .fetch_optional(&state.pool)
    .await
    .map_err(sqlx_error)?
    .ok_or(DomainError::NotFound)?;

    let kind = body.secret_kind.unwrap_or(existing.0);
    if let Some(value) = &body.value {
        let encrypted = state
            .secrets_crypto
            .encrypt(value)
            .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;
        sqlx::query(
            r#"
            UPDATE repository_secrets
            SET secret_kind = $3, encrypted_value = $4, updated_at = NOW()
            WHERE id = $1 AND repository_id = $2
            "#,
        )
        .bind(secret_id)
        .bind(repo.id)
        .bind(kind)
        .bind(&encrypted)
        .execute(&state.pool)
        .await
        .map_err(sqlx_error)?;
    } else if body.secret_kind.is_some() {
        sqlx::query(
            "UPDATE repository_secrets SET secret_kind = $3, updated_at = NOW() WHERE id = $1 AND repository_id = $2",
        )
        .bind(secret_id)
        .bind(repo.id)
        .bind(kind)
        .execute(&state.pool)
        .await
        .map_err(sqlx_error)?;
    }

    fetch_repo_secret_summary(&state.pool, repo.id, secret_id).await
}

async fn delete_repo_secret(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_slug, repo_slug, secret_id)): Path<(String, String, Uuid)>,
) -> Result<StatusCode, ApiError> {
    let org = find_org_for_member(&state.pool, &org_slug, auth.user_id).await?;
    let repo = find_repo_in_org(&state.pool, org.id, &repo_slug).await?;
    ensure_can_admin_repo(&state.pool, org.id, &repo, &auth).await?;

    let result = sqlx::query("DELETE FROM repository_secrets WHERE id = $1 AND repository_id = $2")
        .bind(secret_id)
        .bind(repo.id)
        .execute(&state.pool)
        .await
        .map_err(sqlx_error)?;

    if result.rows_affected() == 0 {
        return Err(DomainError::NotFound.into());
    }
    Ok(StatusCode::NO_CONTENT)
}

pub async fn load_job_secrets_for_runner(
    pool: &PgPool,
    crypto: &SecretsCrypto,
    job_id: Uuid,
    runner_id: Uuid,
) -> Result<RunnerJobSecretsResponse, (StatusCode, String)> {
    let context = sqlx::query_as::<_, (Uuid, Uuid)>(
        r#"
        SELECT r.organization_id, p.repository_id
        FROM job_runs j
        INNER JOIN pipeline_runs p ON p.id = j.pipeline_run_id
        INNER JOIN repositories r ON r.id = p.repository_id
        WHERE j.id = $1 AND j.runner_id = $2
        "#,
    )
    .bind(job_id)
    .bind(runner_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| internal(e.to_string()))?
    .ok_or((StatusCode::NOT_FOUND, "job not found".into()))?;

    let (org_id, repo_id) = context;

    let org_rows = sqlx::query_as::<_, (String, CiSecretKind, Vec<u8>)>(
        r#"
        SELECT name, secret_kind, encrypted_value
        FROM organization_secrets
        WHERE organization_id = $1
        "#,
    )
    .bind(org_id)
    .fetch_all(pool)
    .await
    .map_err(|e| internal(e.to_string()))?;

    let repo_rows = sqlx::query_as::<_, (String, CiSecretKind, Vec<u8>)>(
        r#"
        SELECT name, secret_kind, encrypted_value
        FROM repository_secrets
        WHERE repository_id = $1
        "#,
    )
    .bind(repo_id)
    .fetch_all(pool)
    .await
    .map_err(|e| internal(e.to_string()))?;

    let mut merged: HashMap<String, (CiSecretKind, String)> = HashMap::new();
    for (name, kind, blob) in org_rows {
        let value = crypto
            .decrypt(&blob)
            .map_err(|e| internal(e.to_string()))?;
        merged.insert(name, (kind, value));
    }
    for (name, kind, blob) in repo_rows {
        let value = crypto
            .decrypt(&blob)
            .map_err(|e| internal(e.to_string()))?;
        merged.insert(name, (kind, value));
    }

    let secrets = merged
        .into_iter()
        .map(|(name, (secret_kind, value))| RunnerJobSecret {
            name,
            secret_kind,
            value,
        })
        .collect();

    Ok(RunnerJobSecretsResponse { secrets })
}

async fn fetch_org_secret_summary(
    pool: &PgPool,
    org_id: Uuid,
    secret_id: Uuid,
) -> Result<Json<CiSecretSummary>, ApiError> {
    let row = sqlx::query_as::<_, (Uuid, String, CiSecretKind, DateTime<Utc>, DateTime<Utc>)>(
        r#"
        SELECT id, name, secret_kind, created_at, updated_at
        FROM organization_secrets
        WHERE id = $1 AND organization_id = $2
        "#,
    )
    .bind(secret_id)
    .bind(org_id)
    .fetch_optional(pool)
    .await
    .map_err(sqlx_error)?
    .ok_or(DomainError::NotFound)?;

    Ok(Json(CiSecretSummary {
        id: row.0,
        name: row.1,
        secret_kind: row.2,
        created_at: row.3,
        updated_at: row.4,
    }))
}

async fn fetch_repo_secret_summary(
    pool: &PgPool,
    repo_id: Uuid,
    secret_id: Uuid,
) -> Result<Json<CiSecretSummary>, ApiError> {
    let row = sqlx::query_as::<_, (Uuid, String, CiSecretKind, DateTime<Utc>, DateTime<Utc>)>(
        r#"
        SELECT id, name, secret_kind, created_at, updated_at
        FROM repository_secrets
        WHERE id = $1 AND repository_id = $2
        "#,
    )
    .bind(secret_id)
    .bind(repo_id)
    .fetch_optional(pool)
    .await
    .map_err(sqlx_error)?
    .ok_or(DomainError::NotFound)?;

    Ok(Json(CiSecretSummary {
        id: row.0,
        name: row.1,
        secret_kind: row.2,
        created_at: row.3,
        updated_at: row.4,
    }))
}

fn normalize_secret_name(raw: &str) -> Result<String, ApiError> {
    let name = raw.trim().to_uppercase();
    if name.is_empty() {
        return Err(DomainError::Validation("secret name is required".into()).into());
    }
    if !name
        .chars()
        .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
        || !name.starts_with(|c: char| c.is_ascii_uppercase())
    {
        return Err(DomainError::Validation(
            "secret name must match [A-Z][A-Z0-9_]*".into(),
        )
        .into());
    }
    Ok(name)
}

async fn find_repo_in_org(
    pool: &PgPool,
    org_id: Uuid,
    repo_slug: &str,
) -> Result<pertisk_domain::models::Repository, ApiError> {
    sqlx::query_as::<_, pertisk_domain::models::Repository>(
        r#"
        SELECT id, organization_id, name, slug, description, visibility, default_branch, created_at, updated_at
        FROM repositories
        WHERE organization_id = $1 AND slug = $2
        "#,
    )
    .bind(org_id)
    .bind(repo_slug)
    .fetch_optional(pool)
    .await
    .map_err(sqlx_error)?
    .ok_or(DomainError::NotFound.into())
}

fn sqlx_error(err: sqlx::Error) -> ApiError {
    ApiError::from(DomainError::Internal(err.to_string()))
}

fn internal(msg: String) -> (StatusCode, String) {
    tracing::error!("ci secrets error: {msg}");
    (StatusCode::INTERNAL_SERVER_ERROR, msg)
}
