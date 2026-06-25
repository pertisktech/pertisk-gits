use axum::{
    body::Bytes,
    extract::{Path, Query, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::Deserialize;
use sqlx::PgPool;
use uuid::Uuid;

use crate::access::{find_repository, get_or_create_repository, parse_image_name, ContainerRepo};
use crate::auth::{authorize_registry, registry_err, RegistryAuth, RegistryResult};
use crate::storage::{sha256_digest, BlobStore};

#[derive(Clone)]
pub struct RegistryState {
    pub pool: PgPool,
    pub storage: BlobStore,
    pub jwt_secret: String,
    pub token_url: String,
    pub service_name: String,
}

pub async fn version_check(
    State(state): State<RegistryState>,
    headers: HeaderMap,
) -> RegistryResult<Response> {
    authorize_registry(
        &state.pool,
        &state.jwt_secret,
        &state.token_url,
        &state.service_name,
        &headers,
        None,
        None,
    )
    .await?;
    Ok(Json(serde_json::json!({})).into_response())
}

pub async fn get_manifest(
    State(state): State<RegistryState>,
    Path((org, image, reference)): Path<(String, String, String)>,
    headers: HeaderMap,
) -> RegistryResult<Response> {
    let full_name = format!("{org}/{image}");
    let auth = require_pull(&state, &headers, &full_name).await?;
    let _ = auth;

    let repo = find_repository(&state.pool, &org, &image)
        .await
        .map_err(|e| registry_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?
        .ok_or_else(|| registry_err(StatusCode::NOT_FOUND, "repository not found"))?;

    let digest = resolve_manifest_digest(&state.pool, &repo, &reference)
        .await
        .map_err(|e| registry_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?
        .ok_or_else(|| registry_err(StatusCode::NOT_FOUND, "manifest not found"))?;

    let row = sqlx::query_as::<_, (Vec<u8>, String, i64)>(
        r#"
        SELECT payload, media_type, size_bytes
        FROM container_manifests
        WHERE repository_id = $1 AND digest = $2
        "#,
    )
    .bind(repo.id)
    .bind(&digest)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| registry_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?
    .ok_or_else(|| registry_err(StatusCode::NOT_FOUND, "manifest not found"))?;

    Ok((
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, row.1),
            (
                header::HeaderName::from_static("docker-content-digest"),
                digest.clone(),
            ),
            (header::CONTENT_LENGTH, row.2.to_string()),
        ],
        row.0,
    )
        .into_response())
}

pub async fn head_manifest(
    State(state): State<RegistryState>,
    Path((org, image, reference)): Path<(String, String, String)>,
    headers: HeaderMap,
) -> RegistryResult<Response> {
    let full_name = format!("{org}/{image}");
    let _auth = require_pull(&state, &headers, &full_name).await?;

    let repo = find_repository(&state.pool, &org, &image)
        .await
        .map_err(|e| registry_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?
        .ok_or_else(|| registry_err(StatusCode::NOT_FOUND, "repository not found"))?;

    let digest = resolve_manifest_digest(&state.pool, &repo, &reference)
        .await
        .map_err(|e| registry_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?
        .ok_or_else(|| registry_err(StatusCode::NOT_FOUND, "manifest not found"))?;

    let size = sqlx::query_scalar::<_, i64>(
        "SELECT size_bytes FROM container_manifests WHERE repository_id = $1 AND digest = $2",
    )
    .bind(repo.id)
    .bind(&digest)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| registry_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?
    .ok_or_else(|| registry_err(StatusCode::NOT_FOUND, "manifest not found"))?;

    Ok((
        StatusCode::OK,
        [
            (
                header::HeaderName::from_static("docker-content-digest"),
                digest,
            ),
            (header::CONTENT_LENGTH, size.to_string()),
        ],
    )
        .into_response())
}

pub async fn put_manifest(
    State(state): State<RegistryState>,
    Path((org, image, reference)): Path<(String, String, String)>,
    headers: HeaderMap,
    body: Bytes,
) -> RegistryResult<Response> {
    let full_name = format!("{org}/{image}");
    let auth = require_push(&state, &headers, &full_name).await?;

    let content_type = headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/vnd.docker.distribution.manifest.v2+json")
        .to_string();

    let digest = headers
        .get("docker-content-digest")
        .and_then(|v| v.to_str().ok())
        .map(str::to_string)
        .unwrap_or_else(|| sha256_digest(&body));

    validate_manifest_layers(&state.pool, &state.storage, &body).await?;

    let repo = get_or_create_repository(&state.pool, &org, &image)
        .await
        .map_err(|e| registry_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;

    sqlx::query(
        r#"
        INSERT INTO container_manifests (repository_id, digest, media_type, size_bytes, payload, uploaded_by)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (repository_id, digest) DO UPDATE
        SET media_type = EXCLUDED.media_type,
            size_bytes = EXCLUDED.size_bytes,
            payload = EXCLUDED.payload,
            uploaded_by = EXCLUDED.uploaded_by
        "#,
    )
    .bind(repo.id)
    .bind(&digest)
    .bind(&content_type)
    .bind(body.len() as i64)
    .bind(body.as_ref())
    .bind(auth.user_id)
    .execute(&state.pool)
    .await
    .map_err(|e| registry_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;

    if !reference.starts_with("sha256:") {
        let commit_sha = headers
            .get("x-pertisk-commit-sha")
            .and_then(|v| v.to_str().ok())
            .map(str::to_string);
        sqlx::query(
            r#"
            INSERT INTO container_tags (repository_id, name, manifest_digest, commit_sha)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (repository_id, name) DO UPDATE
            SET manifest_digest = EXCLUDED.manifest_digest,
                commit_sha = COALESCE(EXCLUDED.commit_sha, container_tags.commit_sha),
                updated_at = NOW()
            "#,
        )
        .bind(repo.id)
        .bind(&reference)
        .bind(&digest)
        .bind(commit_sha)
        .execute(&state.pool)
        .await
        .map_err(|e| registry_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    }

    Ok((
        StatusCode::CREATED,
        [(
            header::HeaderName::from_static("docker-content-digest"),
            digest,
        )],
    )
        .into_response())
}

pub async fn get_blob(
    State(state): State<RegistryState>,
    Path((org, image, digest)): Path<(String, String, String)>,
    headers: HeaderMap,
) -> RegistryResult<Response> {
    let full_name = format!("{org}/{image}");
    let _auth = require_pull(&state, &headers, &full_name).await?;
    let _ = parse_image_name(&full_name);

    ensure_blob_record(&state.pool, &digest).await?;

    let data = state
        .storage
        .read_blob(&digest)
        .await
        .map_err(|_| registry_err(StatusCode::NOT_FOUND, "blob not found"))?;

    Ok((
        StatusCode::OK,
        [
            (
                header::HeaderName::from_static("docker-content-digest"),
                digest.clone(),
            ),
            (header::CONTENT_LENGTH, data.len().to_string()),
        ],
        data,
    )
        .into_response())
}

pub async fn head_blob(
    State(state): State<RegistryState>,
    Path((org, image, digest)): Path<(String, String, String)>,
    headers: HeaderMap,
) -> RegistryResult<Response> {
    let full_name = format!("{org}/{image}");
    let _auth = require_pull(&state, &headers, &full_name).await?;

    let size = sqlx::query_scalar::<_, i64>(
        "SELECT size_bytes FROM container_blobs WHERE digest = $1",
    )
    .bind(&digest)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| registry_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?
    .ok_or_else(|| registry_err(StatusCode::NOT_FOUND, "blob not found"))?;

    if !state.storage.blob_exists(&digest).await {
        return Err(registry_err(StatusCode::NOT_FOUND, "blob not found"));
    }

    Ok((
        StatusCode::OK,
        [
            (
                header::HeaderName::from_static("docker-content-digest"),
                digest,
            ),
            (header::CONTENT_LENGTH, size.to_string()),
        ],
    )
        .into_response())
}

pub async fn start_upload(
    State(state): State<RegistryState>,
    Path((org, image)): Path<(String, String)>,
    Query(query): Query<UploadQuery>,
    headers: HeaderMap,
    body: Bytes,
) -> RegistryResult<Response> {
    let full_name = format!("{org}/{image}");
    let _auth = require_push(&state, &headers, &full_name).await?;

    if let Some(digest) = query.digest {
        return store_monolithic_blob(&state, &digest, body).await;
    }

    let upload_id = state.storage.create_upload();
    let location = format!("/v2/{org}/{image}/blobs/uploads/{upload_id}");

    Ok((
        StatusCode::ACCEPTED,
        [(header::LOCATION, location), (header::RANGE, "0-0".to_string())],
    )
        .into_response())
}

#[derive(Deserialize)]
pub struct UploadQuery {
    digest: Option<String>,
}

pub async fn patch_upload(
    State(state): State<RegistryState>,
    Path((org, image, upload_id)): Path<(String, String, Uuid)>,
    headers: HeaderMap,
    body: Bytes,
) -> RegistryResult<Response> {
    let full_name = format!("{org}/{image}");
    let _auth = require_push(&state, &headers, &full_name).await?;

    state
        .storage
        .append_upload(&upload_id, &body)
        .await
        .map_err(|e| registry_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;

    Ok((StatusCode::ACCEPTED, [(header::RANGE, "0-0".to_string())]).into_response())
}

pub async fn complete_upload(
    State(state): State<RegistryState>,
    Path((org, image, upload_id)): Path<(String, String, Uuid)>,
    Query(query): Query<UploadQuery>,
    headers: HeaderMap,
    body: Bytes,
) -> RegistryResult<Response> {
    let full_name = format!("{org}/{image}");
    let _auth = require_push(&state, &headers, &full_name).await?;

    let digest = query
        .digest
        .or_else(|| {
            headers
                .get("docker-content-digest")
                .and_then(|v| v.to_str().ok())
                .map(str::to_string)
        })
        .ok_or_else(|| registry_err(StatusCode::BAD_REQUEST, "digest required"))?;

    if !body.is_empty() {
        state
            .storage
            .write_upload(&upload_id, &body)
            .await
            .map_err(|e| registry_err(StatusCode::BAD_REQUEST, &e.to_string()))?;
    }

    let (storage_key, size) = state
        .storage
        .finalize_upload(&upload_id, &digest)
        .await
        .map_err(|e| {
            tracing::warn!(%upload_id, %digest, error = %e, "blob upload finalize failed");
            registry_err(StatusCode::BAD_REQUEST, &e.to_string())
        })?;

    record_blob(&state.pool, &digest, size, &storage_key).await?;

    Ok((
        StatusCode::CREATED,
        [(
            header::HeaderName::from_static("docker-content-digest"),
            digest,
        )],
    )
        .into_response())
}

async fn store_monolithic_blob(
    state: &RegistryState,
    digest: &str,
    body: Bytes,
) -> RegistryResult<Response> {
    if body.is_empty() {
        return Err(registry_err(StatusCode::BAD_REQUEST, "empty blob body"));
    }

    let computed = sha256_digest(&body);
    if computed != digest {
        return Err(registry_err(
            StatusCode::BAD_REQUEST,
            &format!("digest mismatch: got {computed}, expected {digest}"),
        ));
    }

    let key = state
        .storage
        .write_blob(digest, &body)
        .await
        .map_err(|e| registry_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;

    record_blob(&state.pool, digest, body.len() as i64, &key).await?;

    Ok((
        StatusCode::CREATED,
        [(
            header::HeaderName::from_static("docker-content-digest"),
            digest.to_string(),
        )],
    )
        .into_response())
}

async fn record_blob(
    pool: &PgPool,
    digest: &str,
    size: i64,
    storage_key: &str,
) -> RegistryResult<()> {
    sqlx::query(
        r#"
        INSERT INTO container_blobs (digest, size_bytes, storage_path)
        VALUES ($1, $2, $3)
        ON CONFLICT (digest) DO NOTHING
        "#,
    )
    .bind(digest)
    .bind(size)
    .bind(storage_key)
    .execute(pool)
    .await
    .map_err(|e| registry_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    Ok(())
}

async fn resolve_manifest_digest(
    pool: &PgPool,
    repo: &ContainerRepo,
    reference: &str,
) -> anyhow::Result<Option<String>> {
    if reference.starts_with("sha256:") {
        return Ok(Some(reference.to_string()));
    }
    let digest = sqlx::query_scalar::<_, String>(
        "SELECT manifest_digest FROM container_tags WHERE repository_id = $1 AND name = $2",
    )
    .bind(repo.id)
    .bind(reference)
    .fetch_optional(pool)
    .await?;
    Ok(digest)
}

async fn ensure_blob_record(pool: &PgPool, digest: &str) -> RegistryResult<()> {
    let exists = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM container_blobs WHERE digest = $1)",
    )
    .bind(digest)
    .fetch_one(pool)
    .await
    .map_err(|e| registry_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    if !exists {
        return Err(registry_err(StatusCode::NOT_FOUND, "blob not found"));
    }
    Ok(())
}

async fn validate_manifest_layers(
    pool: &PgPool,
    storage: &BlobStore,
    body: &[u8],
) -> RegistryResult<()> {
    let value: serde_json::Value = serde_json::from_slice(body)
        .map_err(|_| registry_err(StatusCode::BAD_REQUEST, "invalid manifest json"))?;

    let mut digests = Vec::new();
    if let Some(config) = value.get("config").and_then(|c| c.get("digest")).and_then(|d| d.as_str()) {
        digests.push(config.to_string());
    }
    if let Some(layers) = value.get("layers").and_then(|l| l.as_array()) {
        for layer in layers {
            if let Some(d) = layer.get("digest").and_then(|d| d.as_str()) {
                digests.push(d.to_string());
            }
        }
    }

    for digest in digests {
        let in_db = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM container_blobs WHERE digest = $1)",
        )
        .bind(&digest)
        .fetch_one(pool)
        .await
        .map_err(|e| registry_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
        if !in_db && !storage.blob_exists(&digest).await {
            return Err(registry_err(
                StatusCode::BAD_REQUEST,
                &format!("missing blob: {digest}"),
            ));
        }
    }
    Ok(())
}

async fn require_pull(
    state: &RegistryState,
    headers: &HeaderMap,
    repo_name: &str,
) -> RegistryResult<RegistryAuth> {
    require_scope(state, headers, repo_name, "pull").await
}

async fn require_push(
    state: &RegistryState,
    headers: &HeaderMap,
    repo_name: &str,
) -> RegistryResult<RegistryAuth> {
    require_scope(state, headers, repo_name, "push").await
}

async fn require_scope(
    state: &RegistryState,
    headers: &HeaderMap,
    repo_name: &str,
    action: &str,
) -> RegistryResult<RegistryAuth> {
    authorize_registry(
        &state.pool,
        &state.jwt_secret,
        &state.token_url,
        &state.service_name,
        headers,
        Some(repo_name),
        Some(action),
    )
    .await
}
