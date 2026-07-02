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

use pertisk_cicd::{build_predefined_vars, PredefinedCiContext, PullRequestContext};
use crate::permissions::{ensure_can_admin_repo, ensure_can_manage_org_secrets};
use crate::secrets_crypto::SecretsCrypto;
use crate::{find_org_for_member, ApiError, AppState, AuthUser};

pub fn ci_secrets_read_routes() -> Router<AppState> {
    Router::new()
        .route("/organizations/{org_path}/secrets", get(list_org_secrets))
        .route(
            "/organizations/{org_path}/repositories/{repo_slug}/secrets",
            get(list_repo_secrets),
        )
}

pub fn ci_secrets_write_routes() -> Router<AppState> {
    Router::new()
        .route("/organizations/{org_path}/secrets", post(create_org_secret))
        .route(
            "/organizations/{org_path}/secrets/{secret_id}",
            patch(update_org_secret).delete(delete_org_secret),
        )
        .route(
            "/organizations/{org_path}/repositories/{repo_slug}/secrets",
            post(create_repo_secret),
        )
        .route(
            "/organizations/{org_path}/repositories/{repo_slug}/secrets/{secret_id}",
            patch(update_repo_secret).delete(delete_repo_secret),
        )
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, sqlx::Type, PartialEq, Eq)]
#[sqlx(type_name = "ci_config_scope", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum CiConfigScope {
    Secret,
    Variable,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "ci_secret_kind", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum CiSecretKind {
    Variable,
    File,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, sqlx::Type, PartialEq, Eq)]
#[sqlx(type_name = "ci_secret_environment", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum CiSecretEnvironment {
    All,
    Dev,
    Qa,
    Uat,
    Prd,
}

impl CiSecretEnvironment {
    pub fn matches_job(&self, job_environment: Option<&str>) -> bool {
        if matches!(self, Self::All) {
            return true;
        }
        let Some(job_env) = job_environment else {
            return false;
        };
        self.as_str() == job_env
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::All => "all",
            Self::Dev => "dev",
            Self::Qa => "qa",
            Self::Uat => "uat",
            Self::Prd => "prd",
        }
    }
}

impl std::str::FromStr for CiSecretEnvironment {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value.trim().to_ascii_lowercase().as_str() {
            "all" => Ok(Self::All),
            "dev" => Ok(Self::Dev),
            "qa" => Ok(Self::Qa),
            "uat" => Ok(Self::Uat),
            "prd" | "prod" | "production" => Ok(Self::Prd),
            other => Err(format!("invalid environment `{other}`")),
        }
    }
}

#[derive(Serialize)]
struct CiSecretSummary {
    id: Uuid,
    name: String,
    secret_kind: CiSecretKind,
    config_scope: CiConfigScope,
    masked: bool,
    environment: CiSecretEnvironment,
    #[serde(skip_serializing_if = "Option::is_none")]
    value: Option<String>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

#[derive(Deserialize)]
struct UpsertSecretRequest {
    name: String,
    secret_kind: Option<CiSecretKind>,
    config_scope: Option<CiConfigScope>,
    masked: Option<bool>,
    environment: Option<CiSecretEnvironment>,
    value: String,
}

#[derive(Deserialize)]
struct UpdateSecretRequest {
    secret_kind: Option<CiSecretKind>,
    config_scope: Option<CiConfigScope>,
    masked: Option<bool>,
    environment: Option<CiSecretEnvironment>,
    value: Option<String>,
}

#[derive(Serialize)]
pub struct RunnerJobSecret {
    pub name: String,
    pub secret_kind: CiSecretKind,
    pub config_scope: CiConfigScope,
    pub value: String,
    #[serde(default = "default_true")]
    pub masked: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Serialize)]
pub struct RunnerJobSecretsResponse {
    pub secrets: Vec<RunnerJobSecret>,
}

fn default_masked_for_scope(scope: CiConfigScope) -> bool {
    matches!(scope, CiConfigScope::Secret)
}

fn summary_from_row(
    crypto: &SecretsCrypto,
    row: (
        Uuid,
        String,
        CiSecretKind,
        CiConfigScope,
        bool,
        CiSecretEnvironment,
        Vec<u8>,
        DateTime<Utc>,
        DateTime<Utc>,
    ),
) -> Result<CiSecretSummary, ApiError> {
    let (id, name, secret_kind, config_scope, masked, environment, encrypted, created_at, updated_at) =
        row;
    let value = if config_scope == CiConfigScope::Variable {
        Some(
            crypto
                .decrypt(&encrypted)
                .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?,
        )
    } else {
        None
    };
    Ok(CiSecretSummary {
        id,
        name,
        secret_kind,
        config_scope,
        masked,
        environment,
        value,
        created_at,
        updated_at,
    })
}

async fn list_org_secrets(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(org_path): Path<String>,
) -> Result<Json<Vec<CiSecretSummary>>, ApiError> {
    let org = find_org_for_member(&state.pool, &crate::org::org_path_from_param(&org_path), auth.user_id).await?;
    ensure_can_manage_org_secrets(&state.pool, org.id, auth.user_id).await?;

    let rows = sqlx::query_as::<_, (Uuid, String, CiSecretKind, CiConfigScope, bool, CiSecretEnvironment, Vec<u8>, DateTime<Utc>, DateTime<Utc>)>(
        r#"
        SELECT id, name, secret_kind, config_scope, masked, environment, encrypted_value, created_at, updated_at
        FROM organization_secrets
        WHERE organization_id = $1
        ORDER BY config_scope ASC, environment ASC, name ASC
        "#,
    )
    .bind(org.id)
    .fetch_all(&state.pool)
    .await
    .map_err(sqlx_error)?;

    Ok(Json(
        rows.into_iter()
            .map(|row| summary_from_row(&state.secrets_crypto, row))
            .collect::<Result<Vec<_>, _>>()?,
    ))
}

async fn create_org_secret(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(org_path): Path<String>,
    Json(body): Json<UpsertSecretRequest>,
) -> Result<(StatusCode, Json<CiSecretSummary>), ApiError> {
    let org = find_org_for_member(&state.pool, &crate::org::org_path_from_param(&org_path), auth.user_id).await?;
    ensure_can_manage_org_secrets(&state.pool, org.id, auth.user_id).await?;
    let name = normalize_secret_name(&body.name)?;
    let scope = body.config_scope.unwrap_or(CiConfigScope::Secret);
    let kind = match scope {
        CiConfigScope::Variable => CiSecretKind::Variable,
        CiConfigScope::Secret => body.secret_kind.unwrap_or(CiSecretKind::Variable),
    };
    let masked = body.masked.unwrap_or_else(|| default_masked_for_scope(scope));
    let environment = body.environment.unwrap_or(CiSecretEnvironment::All);
    let encrypted = state
        .secrets_crypto
        .encrypt(&body.value)
        .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    let row = sqlx::query_as::<_, (Uuid, String, CiSecretKind, CiConfigScope, bool, CiSecretEnvironment, Vec<u8>, DateTime<Utc>, DateTime<Utc>)>(
        r#"
        INSERT INTO organization_secrets (organization_id, name, secret_kind, config_scope, masked, environment, encrypted_value, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id, name, secret_kind, config_scope, masked, environment, encrypted_value, created_at, updated_at
        "#,
    )
    .bind(org.id)
    .bind(&name)
    .bind(kind)
    .bind(scope)
    .bind(masked)
    .bind(environment)
    .bind(&encrypted)
    .bind(auth.user_id)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| {
        if let sqlx::Error::Database(db) = &e {
            if db.constraint() == Some("organization_secrets_org_name_env_key") {
                return ApiError::from(DomainError::Validation(format!(
                    "entry {name} already exists for environment {env}",
                    env = environment.as_str()
                )));
            }
        }
        sqlx_error(e)
    })?;

    Ok((
        StatusCode::CREATED,
        Json(summary_from_row(&state.secrets_crypto, row)?),
    ))
}

async fn update_org_secret(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_path, secret_id)): Path<(String, Uuid)>,
    Json(body): Json<UpdateSecretRequest>,
) -> Result<Json<CiSecretSummary>, ApiError> {
    let org = find_org_for_member(&state.pool, &crate::org::org_path_from_param(&org_path), auth.user_id).await?;
    ensure_can_manage_org_secrets(&state.pool, org.id, auth.user_id).await?;

    let existing = sqlx::query_as::<_, (CiSecretKind, CiConfigScope, bool)>(
        "SELECT secret_kind, config_scope, masked FROM organization_secrets WHERE id = $1 AND organization_id = $2",
    )
    .bind(secret_id)
    .bind(org.id)
    .fetch_optional(&state.pool)
    .await
    .map_err(sqlx_error)?
    .ok_or(DomainError::NotFound)?;

    let scope = body.config_scope.unwrap_or(existing.1);
    let kind = match scope {
        CiConfigScope::Variable => CiSecretKind::Variable,
        CiConfigScope::Secret => body.secret_kind.unwrap_or(existing.0),
    };
    let masked = body.masked.unwrap_or(if scope == existing.1 {
        existing.2
    } else {
        default_masked_for_scope(scope)
    });

    if let Some(value) = &body.value {
        let encrypted = state
            .secrets_crypto
            .encrypt(value)
            .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;
        sqlx::query(
            r#"
            UPDATE organization_secrets
            SET secret_kind = $3, config_scope = $4, masked = $5, encrypted_value = $6, updated_at = NOW()
            WHERE id = $1 AND organization_id = $2
            "#,
        )
        .bind(secret_id)
        .bind(org.id)
        .bind(kind)
        .bind(scope)
        .bind(masked)
        .bind(&encrypted)
        .execute(&state.pool)
        .await
        .map_err(sqlx_error)?;
    } else if body.secret_kind.is_some() || body.config_scope.is_some() || body.masked.is_some() || body.environment.is_some() {
        sqlx::query(
            r#"
            UPDATE organization_secrets
            SET secret_kind = $3, config_scope = $4, masked = $5, updated_at = NOW()
            WHERE id = $1 AND organization_id = $2
            "#,
        )
        .bind(secret_id)
        .bind(org.id)
        .bind(kind)
        .bind(scope)
        .bind(masked)
        .execute(&state.pool)
        .await
        .map_err(sqlx_error)?;
        if let Some(environment) = body.environment {
            sqlx::query(
                "UPDATE organization_secrets SET environment = $3, updated_at = NOW() WHERE id = $1 AND organization_id = $2",
            )
            .bind(secret_id)
            .bind(org.id)
            .bind(environment)
            .execute(&state.pool)
            .await
            .map_err(sqlx_error)?;
        }
    }

    fetch_org_secret_summary(&state.pool, &state.secrets_crypto, org.id, secret_id).await
}

async fn delete_org_secret(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_path, secret_id)): Path<(String, Uuid)>,
) -> Result<StatusCode, ApiError> {
    let org = find_org_for_member(&state.pool, &crate::org::org_path_from_param(&org_path), auth.user_id).await?;
    ensure_can_manage_org_secrets(&state.pool, org.id, auth.user_id).await?;

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
    Path((org_path, repo_slug)): Path<(String, String)>,
) -> Result<Json<Vec<CiSecretSummary>>, ApiError> {
    let org = find_org_for_member(&state.pool, &crate::org::org_path_from_param(&org_path), auth.user_id).await?;
    let repo = find_repo_in_org(&state.pool, org.id, &repo_slug).await?;
    ensure_can_admin_repo(&state.pool, org.id, &repo, &auth).await?;

    let rows = sqlx::query_as::<_, (Uuid, String, CiSecretKind, CiConfigScope, bool, CiSecretEnvironment, Vec<u8>, DateTime<Utc>, DateTime<Utc>)>(
        r#"
        SELECT id, name, secret_kind, config_scope, masked, environment, encrypted_value, created_at, updated_at
        FROM repository_secrets
        WHERE repository_id = $1
        ORDER BY config_scope ASC, environment ASC, name ASC
        "#,
    )
    .bind(repo.id)
    .fetch_all(&state.pool)
    .await
    .map_err(sqlx_error)?;

    Ok(Json(
        rows.into_iter()
            .map(|row| summary_from_row(&state.secrets_crypto, row))
            .collect::<Result<Vec<_>, _>>()?,
    ))
}

async fn create_repo_secret(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_path, repo_slug)): Path<(String, String)>,
    Json(body): Json<UpsertSecretRequest>,
) -> Result<(StatusCode, Json<CiSecretSummary>), ApiError> {
    let org = find_org_for_member(&state.pool, &crate::org::org_path_from_param(&org_path), auth.user_id).await?;
    let repo = find_repo_in_org(&state.pool, org.id, &repo_slug).await?;
    ensure_can_admin_repo(&state.pool, org.id, &repo, &auth).await?;
    let name = normalize_secret_name(&body.name)?;
    let scope = body.config_scope.unwrap_or(CiConfigScope::Secret);
    let kind = match scope {
        CiConfigScope::Variable => CiSecretKind::Variable,
        CiConfigScope::Secret => body.secret_kind.unwrap_or(CiSecretKind::Variable),
    };
    let masked = body.masked.unwrap_or_else(|| default_masked_for_scope(scope));
    let environment = body.environment.unwrap_or(CiSecretEnvironment::All);
    let encrypted = state
        .secrets_crypto
        .encrypt(&body.value)
        .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    let row = sqlx::query_as::<_, (Uuid, String, CiSecretKind, CiConfigScope, bool, CiSecretEnvironment, Vec<u8>, DateTime<Utc>, DateTime<Utc>)>(
        r#"
        INSERT INTO repository_secrets (repository_id, name, secret_kind, config_scope, masked, environment, encrypted_value, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id, name, secret_kind, config_scope, masked, environment, encrypted_value, created_at, updated_at
        "#,
    )
    .bind(repo.id)
    .bind(&name)
    .bind(kind)
    .bind(scope)
    .bind(masked)
    .bind(environment)
    .bind(&encrypted)
    .bind(auth.user_id)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| {
        if let sqlx::Error::Database(db) = &e {
            if db.constraint() == Some("repository_secrets_repo_name_env_key") {
                return ApiError::from(DomainError::Validation(format!(
                    "entry {name} already exists for environment {env}",
                    env = environment.as_str()
                )));
            }
        }
        sqlx_error(e)
    })?;

    Ok((
        StatusCode::CREATED,
        Json(summary_from_row(&state.secrets_crypto, row)?),
    ))
}

async fn update_repo_secret(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_path, repo_slug, secret_id)): Path<(String, String, Uuid)>,
    Json(body): Json<UpdateSecretRequest>,
) -> Result<Json<CiSecretSummary>, ApiError> {
    let org = find_org_for_member(&state.pool, &crate::org::org_path_from_param(&org_path), auth.user_id).await?;
    let repo = find_repo_in_org(&state.pool, org.id, &repo_slug).await?;
    ensure_can_admin_repo(&state.pool, org.id, &repo, &auth).await?;

    let existing = sqlx::query_as::<_, (CiSecretKind, CiConfigScope, bool)>(
        "SELECT secret_kind, config_scope, masked FROM repository_secrets WHERE id = $1 AND repository_id = $2",
    )
    .bind(secret_id)
    .bind(repo.id)
    .fetch_optional(&state.pool)
    .await
    .map_err(sqlx_error)?
    .ok_or(DomainError::NotFound)?;

    let scope = body.config_scope.unwrap_or(existing.1);
    let kind = match scope {
        CiConfigScope::Variable => CiSecretKind::Variable,
        CiConfigScope::Secret => body.secret_kind.unwrap_or(existing.0),
    };
    let masked = body.masked.unwrap_or(if scope == existing.1 {
        existing.2
    } else {
        default_masked_for_scope(scope)
    });

    if let Some(value) = &body.value {
        let encrypted = state
            .secrets_crypto
            .encrypt(value)
            .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;
        sqlx::query(
            r#"
            UPDATE repository_secrets
            SET secret_kind = $3, config_scope = $4, masked = $5, encrypted_value = $6, updated_at = NOW()
            WHERE id = $1 AND repository_id = $2
            "#,
        )
        .bind(secret_id)
        .bind(repo.id)
        .bind(kind)
        .bind(scope)
        .bind(masked)
        .bind(&encrypted)
        .execute(&state.pool)
        .await
        .map_err(sqlx_error)?;
    } else if body.secret_kind.is_some()
        || body.config_scope.is_some()
        || body.masked.is_some()
        || body.environment.is_some()
    {
        sqlx::query(
            r#"
            UPDATE repository_secrets
            SET secret_kind = $3, config_scope = $4, masked = $5, updated_at = NOW()
            WHERE id = $1 AND repository_id = $2
            "#,
        )
        .bind(secret_id)
        .bind(repo.id)
        .bind(kind)
        .bind(scope)
        .bind(masked)
        .execute(&state.pool)
        .await
        .map_err(sqlx_error)?;
        if let Some(environment) = body.environment {
            sqlx::query(
                "UPDATE repository_secrets SET environment = $3, updated_at = NOW() WHERE id = $1 AND repository_id = $2",
            )
            .bind(secret_id)
            .bind(repo.id)
            .bind(environment)
            .execute(&state.pool)
            .await
            .map_err(sqlx_error)?;
        }
    }

    fetch_repo_secret_summary(&state.pool, &state.secrets_crypto, repo.id, secret_id).await
}

async fn delete_repo_secret(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_path, repo_slug, secret_id)): Path<(String, String, Uuid)>,
) -> Result<StatusCode, ApiError> {
    let org = find_org_for_member(&state.pool, &crate::org::org_path_from_param(&org_path), auth.user_id).await?;
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
    server_url: &str,
) -> Result<RunnerJobSecretsResponse, (StatusCode, String)> {
    #[derive(sqlx::FromRow)]
    struct JobSecretsContextRow {
        organization_id: Uuid,
        repository_id: Uuid,
        effective_environment: Option<String>,
        pipeline_run_id: Uuid,
        commit_sha: String,
        ref_name: String,
        event_type: String,
        target_environment: Option<String>,
        config_path: Option<String>,
        pipeline_created_at: DateTime<Utc>,
        pull_request_number: Option<i32>,
        pipeline_iid: i64,
        job_name: String,
        job_image: Option<String>,
        org_slug: String,
        repo_name: String,
        repo_slug: String,
        default_branch: String,
    }

    let context = sqlx::query_as::<_, JobSecretsContextRow>(
        r#"
        SELECT
            r.organization_id,
            p.repository_id,
            j.effective_environment,
            p.id AS pipeline_run_id,
            p.commit_sha,
            p.ref_name,
            p.event_type::text AS event_type,
            p.target_environment,
            p.config_path,
            p.created_at AS pipeline_created_at,
            p.pull_request_number,
            (
                SELECT COUNT(*)::bigint
                FROM pipeline_runs pr2
                WHERE pr2.repository_id = r.id
                  AND pr2.created_at <= p.created_at
            ) AS pipeline_iid,
            j.job_name,
            j.image AS job_image,
            o.slug AS org_slug,
            r.name AS repo_name,
            r.slug AS repo_slug,
            r.default_branch
        FROM job_runs j
        INNER JOIN pipeline_runs p ON p.id = j.pipeline_run_id
        INNER JOIN repositories r ON r.id = p.repository_id
        INNER JOIN organizations o ON o.id = r.organization_id
        WHERE j.id = $1 AND j.runner_id = $2
        "#,
    )
    .bind(job_id)
    .bind(runner_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| internal(e.to_string()))?
    .ok_or((StatusCode::NOT_FOUND, "job not found".into()))?;

    let pull_request = if let Some(number) = context.pull_request_number {
        sqlx::query_as::<_, (Uuid, i32, String, String, String)>(
            r#"
            SELECT id, number, title, source_branch, target_branch
            FROM pull_requests
            WHERE repository_id = $1 AND number = $2
            "#,
        )
        .bind(context.repository_id)
        .bind(number)
        .fetch_optional(pool)
        .await
        .map_err(|e| internal(e.to_string()))?
        .map(|(id, number, title, source_branch, target_branch)| PullRequestContext {
            id: id.to_string(),
            number,
            title,
            source_branch,
            target_branch,
        })
    } else {
        None
    };

    let predefined_ctx = PredefinedCiContext {
        server_url: server_url.trim_end_matches('/').to_string(),
        pipeline_run_id: context.pipeline_run_id.to_string(),
        pipeline_iid: context.pipeline_iid,
        pipeline_created_at: context.pipeline_created_at,
        pipeline_event: context.event_type,
        config_path: context.config_path,
        target_environment: context.target_environment,
        job_id: job_id.to_string(),
        job_name: context.job_name,
        effective_environment: context.effective_environment.clone(),
        commit_sha: context.commit_sha,
        ref_name: context.ref_name,
        repository_id: context.repository_id.to_string(),
        repo_name: context.repo_name,
        repo_slug: context.repo_slug,
        org_slug: context.org_slug,
        default_branch: context.default_branch,
        pull_request,
        runner_id: Some(runner_id.to_string()),
        job_image: context.job_image,
    };

    let predefined = build_predefined_vars(&predefined_ctx);
    let job_environment = context.effective_environment.as_deref();

    let org_rows = sqlx::query_as::<_, (String, CiSecretKind, CiConfigScope, bool, CiSecretEnvironment, Vec<u8>)>(
        r#"
        SELECT name, secret_kind, config_scope, masked, environment, encrypted_value
        FROM organization_secrets
        WHERE organization_id = $1
        "#,
    )
    .bind(context.organization_id)
    .fetch_all(pool)
    .await
    .map_err(|e| internal(e.to_string()))?;

    let repo_rows = sqlx::query_as::<_, (String, CiSecretKind, CiConfigScope, bool, CiSecretEnvironment, Vec<u8>)>(
        r#"
        SELECT name, secret_kind, config_scope, masked, environment, encrypted_value
        FROM repository_secrets
        WHERE repository_id = $1
        "#,
    )
    .bind(context.repository_id)
    .fetch_all(pool)
    .await
    .map_err(|e| internal(e.to_string()))?;

    let mut merged: HashMap<String, (CiSecretKind, CiConfigScope, String, bool)> = predefined
        .into_iter()
        .map(|(name, value)| {
            (
                name,
                (CiSecretKind::Variable, CiConfigScope::Secret, value, false),
            )
        })
        .collect();

    for (name, kind, scope, masked, environment, blob) in org_rows {
        if !environment.matches_job(job_environment) {
            continue;
        }
        let value = crypto
            .decrypt(&blob)
            .map_err(|e| internal(e.to_string()))?;
        merged.insert(name, (kind, scope, value, masked));
    }
    for (name, kind, scope, masked, environment, blob) in repo_rows {
        if !environment.matches_job(job_environment) {
            continue;
        }
        let value = crypto
            .decrypt(&blob)
            .map_err(|e| internal(e.to_string()))?;
        merged.insert(name, (kind, scope, value, masked));
    }

    let secrets = merged
        .into_iter()
        .map(|(name, (secret_kind, config_scope, value, masked))| RunnerJobSecret {
            name,
            secret_kind,
            config_scope,
            value,
            masked,
        })
        .collect();

    Ok(RunnerJobSecretsResponse { secrets })
}

async fn fetch_org_secret_summary(
    pool: &PgPool,
    crypto: &SecretsCrypto,
    org_id: Uuid,
    secret_id: Uuid,
) -> Result<Json<CiSecretSummary>, ApiError> {
    let row = sqlx::query_as::<_, (Uuid, String, CiSecretKind, CiConfigScope, bool, CiSecretEnvironment, Vec<u8>, DateTime<Utc>, DateTime<Utc>)>(
        r#"
        SELECT id, name, secret_kind, config_scope, masked, environment, encrypted_value, created_at, updated_at
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

    Ok(Json(summary_from_row(crypto, row)?))
}

async fn fetch_repo_secret_summary(
    pool: &PgPool,
    crypto: &SecretsCrypto,
    repo_id: Uuid,
    secret_id: Uuid,
) -> Result<Json<CiSecretSummary>, ApiError> {
    let row = sqlx::query_as::<_, (Uuid, String, CiSecretKind, CiConfigScope, bool, CiSecretEnvironment, Vec<u8>, DateTime<Utc>, DateTime<Utc>)>(
        r#"
        SELECT id, name, secret_kind, config_scope, masked, environment, encrypted_value, created_at, updated_at
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

    Ok(Json(summary_from_row(crypto, row)?))
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
        SELECT id, organization_id, name, slug, description, visibility, default_branch, created_at, updated_at, last_commit_at
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
