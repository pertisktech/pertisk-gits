use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{delete, get, patch, post},
    Json, Router,
};
use chrono::{DateTime, Utc};
use pertisk_domain::{models::OrgRole, DomainError};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

use crate::{find_org_for_member, ApiError, AppState, AuthUser};

pub fn registry_read_routes() -> Router<AppState> {
    Router::new()
        .route(
            "/organizations/{org_slug}/registry/images",
            get(list_container_images),
        )
        .route(
            "/organizations/{org_slug}/registry/images/{image_name}",
            get(get_container_image),
        )
}

pub fn registry_write_routes() -> Router<AppState> {
    Router::new()
        .route(
            "/organizations/{org_slug}/registry/images/{image_name}",
            patch(update_container_image).delete(delete_container_image),
        )
        .route(
            "/organizations/{org_slug}/registry/images/{image_name}/tags/{tag_name}",
            delete(delete_container_tag),
        )
        .route(
            "/organizations/{org_slug}/registry/gc",
            post(run_registry_gc),
        )
}

#[derive(Serialize)]
struct ContainerImageSummary {
    id: Uuid,
    name: String,
    description: Option<String>,
    linked_repository_id: Option<Uuid>,
    linked_repository_slug: Option<String>,
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
    linked_repository_id: Option<Uuid>,
    linked_repository_slug: Option<String>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    tags: Vec<ContainerTagResponse>,
}

#[derive(Deserialize)]
struct UpdateContainerImageRequest {
    description: Option<String>,
    linked_repository_id: Option<Option<Uuid>>,
}

#[derive(Serialize)]
struct GcResponse {
    blobs_removed: u32,
    upload_files_removed: u32,
}

async fn list_container_images(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(org_slug): Path<String>,
) -> Result<Json<Vec<ContainerImageSummary>>, ApiError> {
    let org = find_org_for_member(&state.pool, &org_slug, auth.user_id).await?;

    let rows = sqlx::query_as::<_, (Uuid, String, Option<String>, Option<Uuid>, Option<String>, i64, DateTime<Utc>, DateTime<Utc>)>(
        r#"
        SELECT
            cr.id,
            cr.name,
            cr.description,
            cr.repository_id,
            r.slug AS linked_repo_slug,
            (SELECT COUNT(*) FROM container_tags t WHERE t.repository_id = cr.id) AS tag_count,
            cr.created_at,
            cr.updated_at
        FROM container_repositories cr
        LEFT JOIN repositories r ON r.id = cr.repository_id
        WHERE cr.organization_id = $1
        ORDER BY cr.name ASC
        "#,
    )
    .bind(org.id)
    .fetch_all(&state.pool)
    .await
    .map_err(sqlx_error)?;

    Ok(Json(
        rows.into_iter()
            .map(
                |(id, name, description, linked_repository_id, linked_repository_slug, tag_count, created_at, updated_at)| {
                    ContainerImageSummary {
                        id,
                        name,
                        description,
                        linked_repository_id,
                        linked_repository_slug,
                        tag_count,
                        created_at,
                        updated_at,
                    }
                },
            )
            .collect(),
    ))
}

async fn get_container_image(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_slug, image_name)): Path<(String, String)>,
) -> Result<Json<ContainerImageDetail>, ApiError> {
    let org = find_org_for_member(&state.pool, &org_slug, auth.user_id).await?;
    let repo = load_container_repo(&state.pool, org.id, &image_name)
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
    .bind(repo.id)
    .fetch_all(&state.pool)
    .await
    .map_err(sqlx_error)?;

    Ok(Json(ContainerImageDetail {
        id: repo.id,
        name: repo.name,
        description: repo.description,
        linked_repository_id: repo.linked_repository_id,
        linked_repository_slug: repo.linked_repository_slug,
        created_at: repo.created_at,
        updated_at: repo.updated_at,
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
    Path((org_slug, image_name)): Path<(String, String)>,
    Json(body): Json<UpdateContainerImageRequest>,
) -> Result<Json<ContainerImageDetail>, ApiError> {
    let org = find_org_for_member(&state.pool, &org_slug, auth.user_id).await?;
    ensure_can_manage_org(&state.pool, org.id, auth.user_id).await?;

    let repo = load_container_repo(&state.pool, org.id, &image_name)
        .await?
        .ok_or(ApiError::from(DomainError::NotFound))?;

    if let Some(description) = body.description {
        sqlx::query(
            "UPDATE container_repositories SET description = $2, updated_at = NOW() WHERE id = $1",
        )
        .bind(repo.id)
        .bind(description)
        .execute(&state.pool)
        .await
        .map_err(sqlx_error)?;
    }

    if let Some(link) = body.linked_repository_id {
        if let Some(repo_id) = link {
            let valid = sqlx::query_scalar::<_, bool>(
                "SELECT EXISTS(SELECT 1 FROM repositories WHERE id = $1 AND organization_id = $2)",
            )
            .bind(repo_id)
            .bind(org.id)
            .fetch_one(&state.pool)
            .await
            .map_err(sqlx_error)?;
            if !valid {
                return Err(DomainError::Validation(
                    "linked repository must belong to this organization".into(),
                )
                .into());
            }
        }
        sqlx::query(
            "UPDATE container_repositories SET repository_id = $2, updated_at = NOW() WHERE id = $1",
        )
        .bind(repo.id)
        .bind(link)
        .execute(&state.pool)
        .await
        .map_err(sqlx_error)?;
    }

    get_container_image(State(state), auth, Path((org_slug, image_name))).await
}

async fn delete_container_image(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_slug, image_name)): Path<(String, String)>,
) -> Result<StatusCode, ApiError> {
    let org = find_org_for_member(&state.pool, &org_slug, auth.user_id).await?;
    ensure_can_manage_org(&state.pool, org.id, auth.user_id).await?;

    let repo = load_container_repo(&state.pool, org.id, &image_name)
        .await?
        .ok_or(ApiError::from(DomainError::NotFound))?;

    sqlx::query("DELETE FROM container_repositories WHERE id = $1")
        .bind(repo.id)
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
    Path((org_slug, image_name, tag_name)): Path<(String, String, String)>,
) -> Result<StatusCode, ApiError> {
    let org = find_org_for_member(&state.pool, &org_slug, auth.user_id).await?;
    ensure_can_manage_org(&state.pool, org.id, auth.user_id).await?;

    let repo = load_container_repo(&state.pool, org.id, &image_name)
        .await?
        .ok_or(ApiError::from(DomainError::NotFound))?;

    let result = sqlx::query(
        "DELETE FROM container_tags WHERE repository_id = $1 AND name = $2",
    )
    .bind(repo.id)
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
    Path(org_slug): Path<String>,
) -> Result<Json<GcResponse>, ApiError> {
    let org = find_org_for_member(&state.pool, &org_slug, auth.user_id).await?;
    ensure_can_manage_org(&state.pool, org.id, auth.user_id).await?;

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
    linked_repository_id: Option<Uuid>,
    linked_repository_slug: Option<String>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

async fn load_container_repo(
    pool: &PgPool,
    org_id: Uuid,
    image_name: &str,
) -> Result<Option<ContainerRepoRow>, ApiError> {
    let row = sqlx::query_as::<_, (Uuid, String, Option<String>, Option<Uuid>, Option<String>, DateTime<Utc>, DateTime<Utc>)>(
        r#"
        SELECT cr.id, cr.name, cr.description, cr.repository_id, r.slug, cr.created_at, cr.updated_at
        FROM container_repositories cr
        LEFT JOIN repositories r ON r.id = cr.repository_id
        WHERE cr.organization_id = $1 AND cr.name = $2
        "#,
    )
    .bind(org_id)
    .bind(image_name)
    .fetch_optional(pool)
    .await
    .map_err(sqlx_error)?;

    Ok(row.map(
        |(id, name, description, linked_repository_id, linked_repository_slug, created_at, updated_at)| {
            ContainerRepoRow {
                id,
                name,
                description,
                linked_repository_id,
                linked_repository_slug,
                created_at,
                updated_at,
            }
        },
    ))
}

fn blob_store() -> anyhow::Result<pertisk_registry::storage::BlobStore> {
    let config = pertisk_registry::config::RegistryConfig::from_env()?;
    pertisk_registry::storage::BlobStore::from_config(&config)
}

async fn ensure_can_manage_org(
    pool: &PgPool,
    org_id: Uuid,
    user_id: Uuid,
) -> Result<OrgRole, ApiError> {
    let role = sqlx::query_scalar::<_, OrgRole>(
        "SELECT role FROM organization_members WHERE organization_id = $1 AND user_id = $2",
    )
    .bind(org_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .map_err(sqlx_error)?
    .ok_or(ApiError::from(DomainError::Forbidden))?;

    if matches!(role, OrgRole::Owner | OrgRole::Admin) {
        Ok(role)
    } else {
        Err(DomainError::Forbidden.into())
    }
}

fn sqlx_error(err: sqlx::Error) -> ApiError {
    DomainError::Internal(err.to_string()).into()
}
