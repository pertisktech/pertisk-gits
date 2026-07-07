use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{delete, get, patch, post},
    Json, Router,
};
use chrono::{DateTime, Utc};
use pertisk_domain::DomainError;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

use crate::{ensure_can_write_repo, load_repo_for_read, ApiError, AppState, AuthUser};

pub fn registry_read_routes() -> Router<AppState> {
    Router::new()
        .route(
            "/organizations/{org_path}/repositories/{repo_slug}/registry/images",
            get(list_container_images),
        )
        .route(
            "/organizations/{org_path}/repositories/{repo_slug}/registry/images/{image_name}",
            get(get_container_image),
        )
}

pub fn registry_write_routes() -> Router<AppState> {
    Router::new()
        .route(
            "/organizations/{org_path}/repositories/{repo_slug}/registry/images/{image_name}",
            patch(update_container_image).delete(delete_container_image),
        )
        .route(
            "/organizations/{org_path}/repositories/{repo_slug}/registry/images/{image_name}/tags/{tag_name}",
            delete(delete_container_tag),
        )
        .route(
            "/organizations/{org_path}/repositories/{repo_slug}/registry/gc",
            post(run_registry_gc),
        )
}

#[derive(Deserialize)]
struct RegistryQuery {
    provider: Option<String>,
}

#[derive(Serialize)]
struct ContainerImageSummary {
    id: Uuid,
    name: String,
    description: Option<String>,
    provider: String,
    tag_count: i64,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

#[derive(Serialize)]
struct ContainerTagResponse {
    name: String,
    manifest_digest: String,
    commit_sha: Option<String>,
    media_type: String,
    size_bytes: i64,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

#[derive(Serialize)]
struct ContainerImageDetail {
    id: Uuid,
    name: String,
    description: Option<String>,
    provider: String,
    project_id: Uuid,
    project_slug: String,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    tags: Vec<ContainerTagResponse>,
}

#[derive(Deserialize)]
struct UpdateContainerImageRequest {
    description: Option<String>,
}

#[derive(Serialize)]
struct GcResponse {
    blobs_removed: u32,
    upload_files_removed: u32,
}

async fn list_container_images(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_path, repo_slug)): Path<(String, String)>,
    Query(query): Query<RegistryQuery>,
) -> Result<Json<Vec<ContainerImageSummary>>, ApiError> {
    let (org, repo, _) = load_repo_for_read(
        &state,
        &crate::org::org_path_from_param(&org_path),
        &repo_slug,
        Some(&auth),
    )
    .await?;

    let rows = sqlx::query_as::<_, (Uuid, String, Option<String>, String, i64, DateTime<Utc>, DateTime<Utc>)>(
        r#"
        SELECT
            cr.id,
            cr.name,
            cr.description,
            COALESCE(cr.provider, 'pertisk') AS provider,
            (SELECT COUNT(*) FROM container_tags t WHERE t.repository_id = cr.id) AS tag_count,
            cr.created_at,
            cr.updated_at
        FROM container_repositories cr
        WHERE cr.organization_id = $1
          AND cr.repository_id = $2
                    AND ($3::text IS NULL OR COALESCE(cr.provider, 'pertisk') = $3)
        ORDER BY cr.name ASC
        "#,
    )
    .bind(org.id)
    .bind(repo.id)
        .bind(query.provider.as_deref())
    .fetch_all(&state.pool)
    .await
    .map_err(sqlx_error)?;

    Ok(Json(
        rows
            .into_iter()
            .map(|(id, name, description, provider, tag_count, created_at, updated_at)| {
                ContainerImageSummary {
                    id,
                    name,
                    description,
                    provider,
                    tag_count,
                    created_at,
                    updated_at,
                }
            })
            .collect(),
    ))
}

async fn get_container_image(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_path, repo_slug, image_name)): Path<(String, String, String)>,
    Query(query): Query<RegistryQuery>,
) -> Result<Json<ContainerImageDetail>, ApiError> {
    let (_org, repo, _) = load_repo_for_read(
        &state,
        &crate::org::org_path_from_param(&org_path),
        &repo_slug,
        Some(&auth),
    )
    .await?;

    let image = load_container_repo(&state.pool, repo.id, &image_name, query.provider.as_deref())
        .await?
        .ok_or(ApiError::from(DomainError::NotFound))?;

    let tags = sqlx::query_as::<_, (String, String, Option<String>, String, Vec<u8>, DateTime<Utc>, DateTime<Utc>)>(
        r#"
        SELECT
            t.name,
            t.manifest_digest,
            t.commit_sha,
            m.media_type,
            m.payload,
            t.created_at,
            t.updated_at
        FROM container_tags t
        INNER JOIN container_manifests m
            ON m.repository_id = t.repository_id AND m.digest = t.manifest_digest
        WHERE t.repository_id = $1
        ORDER BY t.updated_at DESC
        "#,
    )
    .bind(image.id)
    .fetch_all(&state.pool)
    .await
    .map_err(sqlx_error)?;

    Ok(Json(ContainerImageDetail {
        id: image.id,
        name: image.name,
        description: image.description,
        provider: image.provider,
        project_id: repo.id,
        project_slug: repo.slug,
        created_at: image.created_at,
        updated_at: image.updated_at,
        tags: tags
            .into_iter()
            .map(
                |(name, manifest_digest, commit_sha, media_type, payload, created_at, updated_at)| {
                    ContainerTagResponse {
                        name,
                        manifest_digest,
                        commit_sha,
                        media_type,
                        size_bytes: pertisk_registry::manifest::image_total_size_bytes(&payload),
                        created_at,
                        updated_at,
                    }
                },
            )
            .collect(),
    }))
}

async fn update_container_image(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_path, repo_slug, image_name)): Path<(String, String, String)>,
    Query(query): Query<RegistryQuery>,
    Json(body): Json<UpdateContainerImageRequest>,
) -> Result<Json<ContainerImageDetail>, ApiError> {
    let (org, repo, _) = load_repo_for_read(
        &state,
        &crate::org::org_path_from_param(&org_path),
        &repo_slug,
        Some(&auth),
    )
    .await?;
    ensure_can_write_repo(&state, &org.full_path, &repo, &auth).await?;

    let image = load_container_repo(&state.pool, repo.id, &image_name, query.provider.as_deref())
        .await?
        .ok_or(ApiError::from(DomainError::NotFound))?;

    if let Some(description) = body.description {
        sqlx::query(
            "UPDATE container_repositories SET description = $2, updated_at = NOW() WHERE id = $1",
        )
        .bind(image.id)
        .bind(description)
        .execute(&state.pool)
        .await
        .map_err(sqlx_error)?;
    }

    get_container_image(
        State(state),
        auth,
        Path((org_path, repo_slug, image_name)),
        Query(RegistryQuery {
            provider: query.provider,
        }),
    )
    .await
}

async fn delete_container_image(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_path, repo_slug, image_name)): Path<(String, String, String)>,
    Query(query): Query<RegistryQuery>,
) -> Result<StatusCode, ApiError> {
    let (org, repo, _) = load_repo_for_read(
        &state,
        &crate::org::org_path_from_param(&org_path),
        &repo_slug,
        Some(&auth),
    )
    .await?;
    ensure_can_write_repo(&state, &org.full_path, &repo, &auth).await?;

    let image = load_container_repo(&state.pool, repo.id, &image_name, query.provider.as_deref())
        .await?
        .ok_or(ApiError::from(DomainError::NotFound))?;

    sqlx::query("DELETE FROM container_repositories WHERE id = $1")
        .bind(image.id)
        .execute(&state.pool)
        .await
        .map_err(sqlx_error)?;

    if let Ok(store) = blob_store() {
        let _ = pertisk_registry::gc::run_gc(&state.pool, &store).await;
    }

    Ok(StatusCode::NO_CONTENT)
}

async fn delete_container_tag(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_path, repo_slug, image_name, tag_name)): Path<(String, String, String, String)>,
    Query(query): Query<RegistryQuery>,
) -> Result<StatusCode, ApiError> {
    let (org, repo, _) = load_repo_for_read(
        &state,
        &crate::org::org_path_from_param(&org_path),
        &repo_slug,
        Some(&auth),
    )
    .await?;
    ensure_can_write_repo(&state, &org.full_path, &repo, &auth).await?;

    let image = load_container_repo(&state.pool, repo.id, &image_name, query.provider.as_deref())
        .await?
        .ok_or(ApiError::from(DomainError::NotFound))?;

    let result = sqlx::query("DELETE FROM container_tags WHERE repository_id = $1 AND name = $2")
        .bind(image.id)
        .bind(tag_name)
        .execute(&state.pool)
        .await
        .map_err(sqlx_error)?;

    if result.rows_affected() == 0 {
        return Err(DomainError::NotFound.into());
    }

    if let Ok(store) = blob_store() {
        let _ = pertisk_registry::gc::run_gc(&state.pool, &store).await;
    }

    Ok(StatusCode::NO_CONTENT)
}

async fn run_registry_gc(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_path, repo_slug)): Path<(String, String)>,
) -> Result<Json<GcResponse>, ApiError> {
    let (org, repo, _) = load_repo_for_read(
        &state,
        &crate::org::org_path_from_param(&org_path),
        &repo_slug,
        Some(&auth),
    )
    .await?;
    ensure_can_write_repo(&state, &org.full_path, &repo, &auth).await?;

    let store = blob_store().map_err(|e| DomainError::Internal(e.to_string()))?;
    let report = pertisk_registry::gc::run_gc(&state.pool, &store)
        .await
        .map_err(|e| DomainError::Internal(e.to_string()))?;

    Ok(Json(GcResponse {
        blobs_removed: report.blobs_removed,
        upload_files_removed: report.upload_files_removed,
    }))
}

struct ContainerRepoRow {
    id: Uuid,
    name: String,
    description: Option<String>,
    provider: String,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

async fn load_container_repo(
    pool: &PgPool,
    project_id: Uuid,
    image_name: &str,
        provider: Option<&str>,
) -> Result<Option<ContainerRepoRow>, ApiError> {
    let row = sqlx::query_as::<_, (Uuid, String, Option<String>, String, DateTime<Utc>, DateTime<Utc>)>(
        r#"
        SELECT cr.id, cr.name, cr.description, COALESCE(cr.provider, 'pertisk'), cr.created_at, cr.updated_at
        FROM container_repositories cr
        WHERE cr.repository_id = $1
          AND cr.name = $2
                    AND ($3::text IS NULL OR COALESCE(cr.provider, 'pertisk') = $3)
                ORDER BY cr.updated_at DESC
                LIMIT 1
        "#,
    )
    .bind(project_id)
    .bind(image_name)
    .bind(provider)
    .fetch_optional(pool)
    .await
    .map_err(sqlx_error)?;

    Ok(row.map(
        |(id, name, description, provider, created_at, updated_at)| ContainerRepoRow {
            id,
            name,
            description,
            provider,
            created_at,
            updated_at,
        },
    ))
}

fn blob_store() -> anyhow::Result<pertisk_registry::storage::BlobStore> {
    let config = pertisk_registry::config::RegistryConfig::from_env()?;
    pertisk_registry::storage::BlobStore::from_config(&config)
}

fn sqlx_error(err: sqlx::Error) -> ApiError {
    DomainError::Internal(err.to_string()).into()
}
