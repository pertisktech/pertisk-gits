use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{delete, get},
    Json, Router,
};
use pertisk_domain::{models::*, DomainError};
use pertisk_git::ssh_keys;
use serde::Serialize;
use uuid::Uuid;
use validator::Validate;

use crate::{
    ensure_can_write_repo, load_repo_for_read, ApiError, AppState, AuthUser,
};

pub fn deploy_key_routes() -> Router<AppState> {
    Router::new()
        .route(
            "/organizations/{org_slug}/repositories/{repo_slug}/deploy-keys",
            get(list_deploy_keys).post(create_deploy_key),
        )
        .route(
            "/organizations/{org_slug}/repositories/{repo_slug}/deploy-keys/{key_id}",
            delete(delete_deploy_key),
        )
}

#[derive(Serialize)]
struct DeployKeyResponse {
    id: Uuid,
    title: String,
    public_key: String,
    fingerprint: String,
    read_only: bool,
    created_at: chrono::DateTime<chrono::Utc>,
}

async fn list_deploy_keys(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_slug, repo_slug)): Path<(String, String)>,
) -> Result<Json<Vec<DeployKeyResponse>>, ApiError> {
    let (_org, repo, _path) =
        load_repo_for_read(&state, &org_slug, &repo_slug, Some(&auth)).await?;
    ensure_can_write_repo(&state, &org_slug, &repo, &auth).await?;

    let rows = sqlx::query_as::<_, RepositoryDeployKey>(
        r#"
        SELECT id, repository_id, title, public_key, fingerprint, read_only, created_by, created_at
        FROM repository_deploy_keys
        WHERE repository_id = $1
        ORDER BY created_at DESC
        "#,
    )
    .bind(repo.id)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    Ok(Json(
        rows.into_iter()
            .map(|row| DeployKeyResponse {
                id: row.id,
                title: row.title,
                public_key: row.public_key,
                fingerprint: row.fingerprint,
                read_only: row.read_only,
                created_at: row.created_at,
            })
            .collect(),
    ))
}

async fn create_deploy_key(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_slug, repo_slug)): Path<(String, String)>,
    Json(body): Json<CreateDeployKeyRequest>,
) -> Result<(StatusCode, Json<DeployKeyResponse>), ApiError> {
    body.validate()
        .map_err(|e| ApiError::from(DomainError::Validation(e.to_string())))?;

    let (_org, repo, _path) =
        load_repo_for_read(&state, &org_slug, &repo_slug, Some(&auth)).await?;
    ensure_can_write_repo(&state, &org_slug, &repo, &auth).await?;

    let parsed = ssh_keys::parse_public_key(&body.public_key)
        .map_err(|e| ApiError::from(DomainError::Validation(e.to_string())))?;

    let row = sqlx::query_as::<_, RepositoryDeployKey>(
        r#"
        INSERT INTO repository_deploy_keys (
            repository_id, title, public_key, fingerprint, read_only, created_by
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, repository_id, title, public_key, fingerprint, read_only, created_by, created_at
        "#,
    )
    .bind(repo.id)
    .bind(&body.title)
    .bind(&parsed.public_key)
    .bind(&parsed.fingerprint)
    .bind(body.read_only)
    .bind(auth.user_id)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| {
        if let sqlx::Error::Database(db_err) = &e {
            if db_err.constraint() == Some("repository_deploy_keys_repository_id_fingerprint_key")
                || db_err.constraint() == Some("repository_deploy_keys_repository_id_title_key")
            {
                return ApiError::from(DomainError::Validation(
                    "deploy key with this title or fingerprint already exists for the repository"
                        .into(),
                ));
            }
        }
        ApiError::from(DomainError::Internal(e.to_string()))
    })?;

    Ok((
        StatusCode::CREATED,
        Json(DeployKeyResponse {
            id: row.id,
            title: row.title,
            public_key: row.public_key,
            fingerprint: row.fingerprint,
            read_only: row.read_only,
            created_at: row.created_at,
        }),
    ))
}

async fn delete_deploy_key(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_slug, repo_slug, key_id)): Path<(String, String, Uuid)>,
) -> Result<StatusCode, ApiError> {
    let (_org, repo, _path) =
        load_repo_for_read(&state, &org_slug, &repo_slug, Some(&auth)).await?;
    ensure_can_write_repo(&state, &org_slug, &repo, &auth).await?;

    let result = sqlx::query(
        r#"
        DELETE FROM repository_deploy_keys
        WHERE id = $1 AND repository_id = $2
        "#,
    )
    .bind(key_id)
    .bind(repo.id)
    .execute(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    if result.rows_affected() == 0 {
        return Err(DomainError::NotFound.into());
    }

    Ok(StatusCode::NO_CONTENT)
}
