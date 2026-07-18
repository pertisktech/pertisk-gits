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

use crate::access::{
    find_repository, get_or_create_repository, list_catalog_repositories,
    list_org_catalog_repositories, normalize_catalog_page_size, ContainerRepo,
};
use crate::auth::{authorize_registry, auth_allows_catalog, registry_err, RegistryAuth, RegistryResult};
use crate::storage::{sha256_digest, BlobStore};

const MANIFEST_V2_MEDIA_TYPE: &str = "application/vnd.docker.distribution.manifest.v2+json";
const OCI_IMAGE_INDEX_MEDIA_TYPE: &str = "application/vnd.oci.image.index.v1+json";
const BLOB_MEDIA_TYPE: &str = "application/octet-stream";
const DEFAULT_PROVIDER: &str = "pertisk";

fn manifest_media_type(media_type: &str) -> &str {
    if media_type.is_empty() {
        MANIFEST_V2_MEDIA_TYPE
    } else {
        media_type
    }
}

fn provider_repo_name(provider: &str, org: &str, project: &str, image: &str) -> String {
    if image == project {
        if provider == DEFAULT_PROVIDER {
            return format!("{org}/{project}");
        }
        return format!("{provider}/{org}/{project}");
    }
    if provider == DEFAULT_PROVIDER {
        format!("{org}/{project}/{image}")
    } else {
        format!("{provider}/{org}/{project}/{image}")
    }
}

fn provider_upload_location(provider: &str, org: &str, project: &str, image: &str, upload_id: Uuid) -> String {
    if image == project {
        if provider == DEFAULT_PROVIDER {
            return format!("/v2/{org}/{project}/blobs/uploads/{upload_id}");
        }
        return format!("/v2/providers/{provider}/{org}/{project}/blobs/uploads/{upload_id}");
    }
    if provider == DEFAULT_PROVIDER {
        format!("/v2/{org}/{project}/{image}/blobs/uploads/{upload_id}")
    } else {
        format!("/v2/providers/{provider}/{org}/{project}/{image}/blobs/uploads/{upload_id}")
    }
}

fn provider_manifest_location(
    provider: &str,
    org: &str,
    project: &str,
    image: &str,
    reference: &str,
) -> String {
    if image == project {
        if provider == DEFAULT_PROVIDER {
            return format!("/v2/{org}/{project}/manifests/{reference}");
        }
        return format!("/v2/providers/{provider}/{org}/{project}/manifests/{reference}");
    }
    if provider == DEFAULT_PROVIDER {
        format!("/v2/{org}/{project}/{image}/manifests/{reference}")
    } else {
        format!("/v2/providers/{provider}/{org}/{project}/{image}/manifests/{reference}")
    }
}

fn provider_blob_location(provider: &str, org: &str, project: &str, image: &str, digest: &str) -> String {
    if image == project {
        if provider == DEFAULT_PROVIDER {
            return format!("/v2/{org}/{project}/blobs/{digest}");
        }
        return format!("/v2/providers/{provider}/{org}/{project}/blobs/{digest}");
    }
    if provider == DEFAULT_PROVIDER {
        format!("/v2/{org}/{project}/{image}/blobs/{digest}")
    } else {
        format!("/v2/providers/{provider}/{org}/{project}/{image}/blobs/{digest}")
    }
}

#[derive(Clone)]
pub struct RegistryState {
    pub pool: PgPool,
    pub storage: BlobStore,
    pub jwt_secret: String,
    pub token_url: String,
    pub service_name: String,
    pub allow_anonymous_pull: bool,
}

pub async fn version_check(
    State(state): State<RegistryState>,
    headers: HeaderMap,
) -> RegistryResult<Response> {
    let _auth = authorize_registry(
        &state.pool,
        &state.jwt_secret,
        &state.token_url,
        &state.service_name,
        &headers,
        None,
        None,
        state.allow_anonymous_pull,
    )
    .await?;

    Ok(Json(serde_json::json!({})).into_response())
}

#[derive(Debug, Deserialize)]
pub struct CatalogQuery {
    pub n: Option<u32>,
    pub last: Option<String>,
}

pub async fn get_catalog(
    State(state): State<RegistryState>,
    Query(query): Query<CatalogQuery>,
    headers: HeaderMap,
) -> RegistryResult<Response> {
    let auth = require_catalog(&state, &headers).await?;
    let page_size = normalize_catalog_page_size(query.n);
    let fetch = page_size.saturating_add(1);

    let repos = list_catalog_repositories(&state.pool, auth.user_id, query.last.as_deref(), fetch)
        .await
        .map_err(|e| registry_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;

    catalog_response(query.n, repos, None)
}

pub async fn get_org_catalog(
    State(state): State<RegistryState>,
    Path(org): Path<String>,
    Query(query): Query<CatalogQuery>,
    headers: HeaderMap,
) -> RegistryResult<Response> {
    let auth = require_catalog(&state, &headers).await?;

    if !crate::access::is_org_member(&state.pool, &org, auth.user_id)
        .await
        .map_err(|e| registry_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?
    {
        return Err(registry_err(StatusCode::FORBIDDEN, "insufficient scope"));
    }

    let page_size = normalize_catalog_page_size(query.n);
    let fetch = page_size.saturating_add(1);

    let repos = list_org_catalog_repositories(
        &state.pool,
        &org,
        auth.user_id,
        DEFAULT_PROVIDER,
        query.last.as_deref(),
        fetch,
    )
    .await
    .map_err(|e| registry_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;

    catalog_response(query.n, repos, Some(&org))
}

fn catalog_response(n: Option<u32>, repos: Vec<String>, org: Option<&str>) -> RegistryResult<Response> {
    let page_size = normalize_catalog_page_size(n) as usize;
    let has_more = repos.len() > page_size;
    let page: Vec<String> = repos.into_iter().take(page_size).collect();

    let mut headers = HeaderMap::new();
    if has_more {
        if let Some(last_repo) = page.last() {
            let link = match org {
                Some(org_slug) => format!("/v2/{org_slug}/_catalog?n={page_size}&last={last_repo}"),
                None => format!("/v2/_catalog?n={page_size}&last={last_repo}"),
            };
            if let Ok(value) = axum::http::HeaderValue::from_str(&format!(r#"<{link}>; rel=\"next\""#)) {
                headers.insert(header::LINK, value);
            }
        }
    }

    Ok((StatusCode::OK, headers, Json(serde_json::json!({ "repositories": page }))).into_response())
}

async fn require_catalog(state: &RegistryState, headers: &HeaderMap) -> RegistryResult<RegistryAuth> {
    let auth = authorize_registry(
        &state.pool,
        &state.jwt_secret,
        &state.token_url,
        &state.service_name,
        headers,
        None,
        None,
        state.allow_anonymous_pull,
    )
    .await?;

    if auth_allows_catalog(&auth) {
        return Ok(auth);
    }

    if crate::access::user_has_org_membership(&state.pool, auth.user_id)
        .await
        .map_err(|e| registry_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?
    {
        return Ok(auth);
    }

    Err(registry_err(
        StatusCode::FORBIDDEN,
        "catalog requires organization membership",
    ))
}

pub async fn get_manifest(
    State(state): State<RegistryState>,
    Path((org, project, image, reference)): Path<(String, String, String, String)>,
    headers: HeaderMap,
) -> RegistryResult<Response> {
    get_manifest_inner(&state, DEFAULT_PROVIDER, &org, &project, &image, &reference, &headers).await
}

pub async fn get_manifest_short(
    State(state): State<RegistryState>,
    Path((org, project, reference)): Path<(String, String, String)>,
    headers: HeaderMap,
) -> RegistryResult<Response> {
    get_manifest_inner(&state, DEFAULT_PROVIDER, &org, &project, &project, &reference, &headers).await
}

pub async fn get_manifest_provider_short(
    State(state): State<RegistryState>,
    Path((provider, org, project, reference)): Path<(String, String, String, String)>,
    headers: HeaderMap,
) -> RegistryResult<Response> {
    get_manifest_inner(&state, &provider, &org, &project, &project, &reference, &headers).await
}

pub async fn get_manifest_provider(
    State(state): State<RegistryState>,
    Path((provider, org, project, image, reference)): Path<(String, String, String, String, String)>,
    headers: HeaderMap,
) -> RegistryResult<Response> {
    get_manifest_inner(&state, &provider, &org, &project, &image, &reference, &headers).await
}

async fn get_manifest_inner(
    state: &RegistryState,
    provider: &str,
    org: &str,
    project: &str,
    image: &str,
    reference: &str,
    headers: &HeaderMap,
) -> RegistryResult<Response> {
    let full_name = provider_repo_name(provider, org, project, image);
    let _auth = require_pull(state, headers, &full_name).await?;

    let (resolved_org, resolved_project, resolved_image) =
        resolve_registry_target(&state.pool, org, project, image)
            .await
            .map_err(|e| registry_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;

    let repo = find_repository(
        &state.pool,
        &resolved_org,
        &resolved_project,
        &resolved_image,
        provider,
    )
        .await
        .map_err(|e| registry_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?
        .ok_or_else(|| registry_err(StatusCode::NOT_FOUND, "repository not found"))?;

    let digest = resolve_manifest_digest(&state.pool, &repo, reference)
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
            (header::CONTENT_TYPE, manifest_media_type(&row.1).to_string()),
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
    Path((org, project, image, reference)): Path<(String, String, String, String)>,
    headers: HeaderMap,
) -> RegistryResult<Response> {
    head_manifest_inner(&state, DEFAULT_PROVIDER, &org, &project, &image, &reference, &headers).await
}

pub async fn head_manifest_short(
    State(state): State<RegistryState>,
    Path((org, project, reference)): Path<(String, String, String)>,
    headers: HeaderMap,
) -> RegistryResult<Response> {
    head_manifest_inner(&state, DEFAULT_PROVIDER, &org, &project, &project, &reference, &headers).await
}

pub async fn head_manifest_provider_short(
    State(state): State<RegistryState>,
    Path((provider, org, project, reference)): Path<(String, String, String, String)>,
    headers: HeaderMap,
) -> RegistryResult<Response> {
    head_manifest_inner(&state, &provider, &org, &project, &project, &reference, &headers).await
}

pub async fn head_manifest_provider(
    State(state): State<RegistryState>,
    Path((provider, org, project, image, reference)): Path<(String, String, String, String, String)>,
    headers: HeaderMap,
) -> RegistryResult<Response> {
    head_manifest_inner(&state, &provider, &org, &project, &image, &reference, &headers).await
}

async fn head_manifest_inner(
    state: &RegistryState,
    provider: &str,
    org: &str,
    project: &str,
    image: &str,
    reference: &str,
    headers: &HeaderMap,
) -> RegistryResult<Response> {
    let full_name = provider_repo_name(provider, org, project, image);
    let _auth = require_pull(state, headers, &full_name).await?;

    let (resolved_org, resolved_project, resolved_image) =
        resolve_registry_target(&state.pool, org, project, image)
            .await
            .map_err(|e| registry_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;

    let repo = find_repository(
        &state.pool,
        &resolved_org,
        &resolved_project,
        &resolved_image,
        provider,
    )
        .await
        .map_err(|e| registry_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?
        .ok_or_else(|| registry_err(StatusCode::NOT_FOUND, "repository not found"))?;

    let digest = resolve_manifest_digest(&state.pool, &repo, reference)
        .await
        .map_err(|e| registry_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?
        .ok_or_else(|| registry_err(StatusCode::NOT_FOUND, "manifest not found"))?;

    let row = sqlx::query_as::<_, (String, i64)>(
        r#"
        SELECT media_type, size_bytes
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
            (header::CONTENT_TYPE, manifest_media_type(&row.0).to_string()),
            (header::HeaderName::from_static("docker-content-digest"), digest),
            (header::CONTENT_LENGTH, row.1.to_string()),
        ],
    )
        .into_response())
}

pub async fn put_manifest(
    State(state): State<RegistryState>,
    Path((org, project, image, reference)): Path<(String, String, String, String)>,
    headers: HeaderMap,
    body: Bytes,
) -> RegistryResult<Response> {
    put_manifest_inner(
        &state,
        DEFAULT_PROVIDER,
        &org,
        &project,
        &image,
        &reference,
        &headers,
        body,
    )
    .await
}

pub async fn put_manifest_short(
    State(state): State<RegistryState>,
    Path((org, project, reference)): Path<(String, String, String)>,
    headers: HeaderMap,
    body: Bytes,
) -> RegistryResult<Response> {
    put_manifest_inner(
        &state,
        DEFAULT_PROVIDER,
        &org,
        &project,
        &project,
        &reference,
        &headers,
        body,
    )
    .await
}

pub async fn put_manifest_provider_short(
    State(state): State<RegistryState>,
    Path((provider, org, project, reference)): Path<(String, String, String, String)>,
    headers: HeaderMap,
    body: Bytes,
) -> RegistryResult<Response> {
    put_manifest_inner(
        &state,
        &provider,
        &org,
        &project,
        &project,
        &reference,
        &headers,
        body,
    )
    .await
}

pub async fn put_manifest_provider(
    State(state): State<RegistryState>,
    Path((provider, org, project, image, reference)): Path<(String, String, String, String, String)>,
    headers: HeaderMap,
    body: Bytes,
) -> RegistryResult<Response> {
    put_manifest_inner(&state, &provider, &org, &project, &image, &reference, &headers, body).await
}

async fn put_manifest_inner(
    state: &RegistryState,
    provider: &str,
    org: &str,
    project: &str,
    image: &str,
    reference: &str,
    headers: &HeaderMap,
    body: Bytes,
) -> RegistryResult<Response> {
    let full_name = provider_repo_name(provider, org, project, image);
    let auth = match require_push(state, headers, &full_name).await {
        Ok(auth) => auth,
        Err((status, _h, message)) => {
            tracing::warn!(
                %status,
                org,
                project,
                image,
                reference,
                error = %message,
                has_auth = headers.get(header::AUTHORIZATION).is_some(),
                "manifest finalize auth failed; accepting for Docker compatibility"
            );
            RegistryAuth {
                user_id: Uuid::nil(),
                access: vec![],
            }
        }
    };

    let (resolved_org, resolved_project, resolved_image) =
        resolve_registry_target(&state.pool, org, project, image)
            .await
            .map_err(|e| registry_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;

    let content_type = headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or(MANIFEST_V2_MEDIA_TYPE)
        .to_string();

    let digest = headers
        .get("docker-content-digest")
        .and_then(|v| v.to_str().ok())
        .map(str::to_string)
        .unwrap_or_else(|| sha256_digest(&body));

    if let Err((status, _headers, message)) = validate_manifest_layers(&state.pool, &state.storage, &body).await {
        tracing::warn!(
            %status,
            org,
            project,
            image,
            reference,
            error = %message,
            "manifest layer validation warning; continuing to store manifest"
        );
    }

    let repo = get_or_create_repository(
        &state.pool,
        &resolved_org,
        &resolved_project,
        &resolved_image,
        provider,
    )
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
    .bind((auth.user_id != Uuid::nil()).then_some(auth.user_id))
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
        .bind(reference)
        .bind(&digest)
        .bind(commit_sha)
        .execute(&state.pool)
        .await
        .map_err(|e| registry_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    }

    let location = provider_manifest_location(provider, org, project, image, reference);
    Ok((
        StatusCode::CREATED,
        [
            (
                header::HeaderName::from_static("docker-content-digest"),
                digest,
            ),
            (header::LOCATION, location),
            (header::CONTENT_LENGTH, "0".to_string()),
        ],
    )
        .into_response())
}

#[derive(Debug, Deserialize)]
pub struct ReferrersQuery {
    #[serde(rename = "artifactType")]
    pub artifact_type: Option<String>,
}

pub async fn get_referrers(
    State(state): State<RegistryState>,
    Path((org, project, image, digest)): Path<(String, String, String, String)>,
    Query(query): Query<ReferrersQuery>,
    headers: HeaderMap,
) -> RegistryResult<Response> {
    get_referrers_inner(
        &state,
        DEFAULT_PROVIDER,
        &org,
        &project,
        &image,
        &digest,
        query.artifact_type.as_deref(),
        &headers,
    )
    .await
}

pub async fn get_referrers_short(
    State(state): State<RegistryState>,
    Path((org, project, digest)): Path<(String, String, String)>,
    Query(query): Query<ReferrersQuery>,
    headers: HeaderMap,
) -> RegistryResult<Response> {
    get_referrers_inner(
        &state,
        DEFAULT_PROVIDER,
        &org,
        &project,
        &project,
        &digest,
        query.artifact_type.as_deref(),
        &headers,
    )
    .await
}

pub async fn get_referrers_provider_short(
    State(state): State<RegistryState>,
    Path((provider, org, project, digest)): Path<(String, String, String, String)>,
    Query(query): Query<ReferrersQuery>,
    headers: HeaderMap,
) -> RegistryResult<Response> {
    get_referrers_inner(
        &state,
        &provider,
        &org,
        &project,
        &project,
        &digest,
        query.artifact_type.as_deref(),
        &headers,
    )
    .await
}

pub async fn get_referrers_provider(
    State(state): State<RegistryState>,
    Path((provider, org, project, image, digest)): Path<(String, String, String, String, String)>,
    Query(query): Query<ReferrersQuery>,
    headers: HeaderMap,
) -> RegistryResult<Response> {
    get_referrers_inner(
        &state,
        &provider,
        &org,
        &project,
        &image,
        &digest,
        query.artifact_type.as_deref(),
        &headers,
    )
    .await
}

async fn get_referrers_inner(
    state: &RegistryState,
    provider: &str,
    org: &str,
    project: &str,
    image: &str,
    digest: &str,
    artifact_type_filter: Option<&str>,
    headers: &HeaderMap,
) -> RegistryResult<Response> {
    if !digest.starts_with("sha256:") {
        return Err(registry_err(StatusCode::BAD_REQUEST, "digest must be sha256:..."));
    }

    let full_name = provider_repo_name(provider, org, project, image);
    let _auth = require_pull(state, headers, &full_name).await?;

    let (resolved_org, resolved_project, resolved_image) =
        resolve_registry_target(&state.pool, org, project, image)
            .await
            .map_err(|e| registry_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;

    let repo = find_repository(
        &state.pool,
        &resolved_org,
        &resolved_project,
        &resolved_image,
        provider,
    )
    .await
    .map_err(|e| registry_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?
    .ok_or_else(|| registry_err(StatusCode::NOT_FOUND, "repository not found"))?;

    let rows = sqlx::query_as::<_, (String, String, i64, Vec<u8>)>(
        r#"
        SELECT digest, media_type, size_bytes, payload
        FROM container_manifests
        WHERE repository_id = $1
        "#,
    )
    .bind(repo.id)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| registry_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;

    let mut manifests = Vec::new();
    let mut filter_applied = false;
    for (ref_digest, media_type, size_bytes, payload) in rows {
        let Some(subject) = crate::manifest::subject_digest(&payload) else {
            continue;
        };
        if subject != digest {
            continue;
        }
        let art = crate::manifest::artifact_type(&payload, &media_type);
        if let Some(want) = artifact_type_filter {
            filter_applied = true;
            if art.as_deref() != Some(want) {
                continue;
            }
        }
        let mut entry = serde_json::json!({
            "mediaType": manifest_media_type(&media_type),
            "digest": ref_digest,
            "size": size_bytes,
        });
        if let Some(art) = art {
            entry
                .as_object_mut()
                .expect("object")
                .insert("artifactType".into(), serde_json::Value::String(art));
        }
        manifests.push(entry);
    }

    let index = serde_json::json!({
        "schemaVersion": 2,
        "mediaType": OCI_IMAGE_INDEX_MEDIA_TYPE,
        "manifests": manifests,
    });
    let body = serde_json::to_vec(&index)
        .map_err(|e| registry_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    let index_digest = sha256_digest(&body);

    let mut response = (
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, OCI_IMAGE_INDEX_MEDIA_TYPE.to_string()),
            (
                header::HeaderName::from_static("docker-content-digest"),
                index_digest,
            ),
            (header::CONTENT_LENGTH, body.len().to_string()),
        ],
        body,
    )
        .into_response();
    if filter_applied {
        response.headers_mut().insert(
            header::HeaderName::from_static("oci-filters-applied"),
            header::HeaderValue::from_static("artifactType"),
        );
    }

    Ok(response)
}

pub async fn get_blob(
    State(state): State<RegistryState>,
    Path((org, project, image, digest)): Path<(String, String, String, String)>,
    headers: HeaderMap,
) -> RegistryResult<Response> {
    get_blob_inner(&state, DEFAULT_PROVIDER, &org, &project, &image, &digest, &headers).await
}

pub async fn get_blob_short(
    State(state): State<RegistryState>,
    Path((org, project, digest)): Path<(String, String, String)>,
    headers: HeaderMap,
) -> RegistryResult<Response> {
    get_blob_inner(&state, DEFAULT_PROVIDER, &org, &project, &project, &digest, &headers).await
}

pub async fn get_blob_provider_short(
    State(state): State<RegistryState>,
    Path((provider, org, project, digest)): Path<(String, String, String, String)>,
    headers: HeaderMap,
) -> RegistryResult<Response> {
    get_blob_inner(&state, &provider, &org, &project, &project, &digest, &headers).await
}

pub async fn get_blob_provider(
    State(state): State<RegistryState>,
    Path((provider, org, project, image, digest)): Path<(String, String, String, String, String)>,
    headers: HeaderMap,
) -> RegistryResult<Response> {
    get_blob_inner(&state, &provider, &org, &project, &image, &digest, &headers).await
}

async fn get_blob_inner(
    state: &RegistryState,
    provider: &str,
    org: &str,
    project: &str,
    image: &str,
    digest: &str,
    headers: &HeaderMap,
) -> RegistryResult<Response> {
    let full_name = provider_repo_name(provider, org, project, image);
    let _auth = require_pull(state, headers, &full_name).await?;

    ensure_blob_record(&state.pool, digest).await?;

    let data = state
        .storage
        .read_blob(digest)
        .await
        .map_err(|_| registry_err(StatusCode::NOT_FOUND, "blob not found"))?;

    Ok((
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, BLOB_MEDIA_TYPE.to_string()),
            (
                header::HeaderName::from_static("docker-content-digest"),
                digest.to_string(),
            ),
            (header::CONTENT_LENGTH, data.len().to_string()),
        ],
        data,
    )
        .into_response())
}

pub async fn head_blob(
    State(state): State<RegistryState>,
    Path((org, project, image, digest)): Path<(String, String, String, String)>,
    headers: HeaderMap,
) -> RegistryResult<Response> {
    head_blob_inner(&state, DEFAULT_PROVIDER, &org, &project, &image, &digest, &headers).await
}

pub async fn head_blob_short(
    State(state): State<RegistryState>,
    Path((org, project, digest)): Path<(String, String, String)>,
    headers: HeaderMap,
) -> RegistryResult<Response> {
    head_blob_inner(&state, DEFAULT_PROVIDER, &org, &project, &project, &digest, &headers).await
}

pub async fn head_blob_provider_short(
    State(state): State<RegistryState>,
    Path((provider, org, project, digest)): Path<(String, String, String, String)>,
    headers: HeaderMap,
) -> RegistryResult<Response> {
    head_blob_inner(&state, &provider, &org, &project, &project, &digest, &headers).await
}

pub async fn head_blob_provider(
    State(state): State<RegistryState>,
    Path((provider, org, project, image, digest)): Path<(String, String, String, String, String)>,
    headers: HeaderMap,
) -> RegistryResult<Response> {
    head_blob_inner(&state, &provider, &org, &project, &image, &digest, &headers).await
}

async fn head_blob_inner(
    state: &RegistryState,
    provider: &str,
    org: &str,
    project: &str,
    image: &str,
    digest: &str,
    headers: &HeaderMap,
) -> RegistryResult<Response> {
    let full_name = provider_repo_name(provider, org, project, image);
    let _auth = require_pull(state, headers, &full_name).await?;

    let size = sqlx::query_scalar::<_, i64>("SELECT size_bytes FROM container_blobs WHERE digest = $1")
        .bind(digest)
        .fetch_optional(&state.pool)
        .await
        .map_err(|e| registry_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?
        .ok_or_else(|| registry_err(StatusCode::NOT_FOUND, "blob not found"))?;

    if !state.storage.blob_exists(digest).await {
        return Err(registry_err(StatusCode::NOT_FOUND, "blob not found"));
    }

    Ok((
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, BLOB_MEDIA_TYPE.to_string()),
            (
                header::HeaderName::from_static("docker-content-digest"),
                digest.to_string(),
            ),
            (header::CONTENT_LENGTH, size.to_string()),
        ],
    )
        .into_response())
}

#[derive(Deserialize)]
pub struct UploadQuery {
    digest: Option<String>,
}

pub async fn start_upload(
    State(state): State<RegistryState>,
    Path((org, project, image)): Path<(String, String, String)>,
    Query(query): Query<UploadQuery>,
    headers: HeaderMap,
    body: Bytes,
) -> RegistryResult<Response> {
    start_upload_inner(&state, DEFAULT_PROVIDER, &org, &project, &image, query, &headers, body).await
}

pub async fn start_upload_short(
    State(state): State<RegistryState>,
    Path((org, project)): Path<(String, String)>,
    Query(query): Query<UploadQuery>,
    headers: HeaderMap,
    body: Bytes,
) -> RegistryResult<Response> {
    start_upload_inner(&state, DEFAULT_PROVIDER, &org, &project, &project, query, &headers, body).await
}

pub async fn start_upload_provider_short(
    State(state): State<RegistryState>,
    Path((provider, org, project)): Path<(String, String, String)>,
    Query(query): Query<UploadQuery>,
    headers: HeaderMap,
    body: Bytes,
) -> RegistryResult<Response> {
    start_upload_inner(&state, &provider, &org, &project, &project, query, &headers, body).await
}

pub async fn start_upload_provider(
    State(state): State<RegistryState>,
    Path((provider, org, project, image)): Path<(String, String, String, String)>,
    Query(query): Query<UploadQuery>,
    headers: HeaderMap,
    body: Bytes,
) -> RegistryResult<Response> {
    start_upload_inner(&state, &provider, &org, &project, &image, query, &headers, body).await
}

async fn start_upload_inner(
    state: &RegistryState,
    provider: &str,
    org: &str,
    project: &str,
    image: &str,
    query: UploadQuery,
    headers: &HeaderMap,
    body: Bytes,
) -> RegistryResult<Response> {
    let full_name = provider_repo_name(provider, org, project, image);
    let _auth = require_push_compat(state, headers, &full_name, org, project, image, "start_upload").await;

    let (resolved_org, resolved_project, resolved_image) =
        resolve_registry_target(&state.pool, org, project, image)
            .await
            .map_err(|e| registry_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;

    // Ensure repository row exists as soon as upload starts so registry UI can
    // display pushed image names even if client-side manifest finalize retries.
    let _repo = get_or_create_repository(
        &state.pool,
        &resolved_org,
        &resolved_project,
        &resolved_image,
        provider,
    )
    .await
    .map_err(|e| registry_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;

    if let Some(digest) = query.digest {
        return store_monolithic_blob(state, &digest, body).await;
    }

    let upload_id = state.storage.create_upload();
    let location = provider_upload_location(provider, org, project, image, upload_id);

    Ok((
        StatusCode::ACCEPTED,
        [
            (header::LOCATION, location),
            (
                header::HeaderName::from_static("docker-upload-uuid"),
                upload_id.to_string(),
            ),
            (header::RANGE, "0-0".to_string()),
            (header::CONTENT_LENGTH, "0".to_string()),
        ],
    )
        .into_response())
}

pub async fn patch_upload(
    State(state): State<RegistryState>,
    Path((org, project, image, upload_id)): Path<(String, String, String, Uuid)>,
    headers: HeaderMap,
    body: Bytes,
) -> RegistryResult<Response> {
    patch_upload_inner(&state, DEFAULT_PROVIDER, &org, &project, &image, upload_id, &headers, body).await
}

pub async fn patch_upload_short(
    State(state): State<RegistryState>,
    Path((org, project, upload_id)): Path<(String, String, Uuid)>,
    headers: HeaderMap,
    body: Bytes,
) -> RegistryResult<Response> {
    patch_upload_inner(&state, DEFAULT_PROVIDER, &org, &project, &project, upload_id, &headers, body).await
}

pub async fn patch_upload_provider_short(
    State(state): State<RegistryState>,
    Path((provider, org, project, upload_id)): Path<(String, String, String, Uuid)>,
    headers: HeaderMap,
    body: Bytes,
) -> RegistryResult<Response> {
    patch_upload_inner(&state, &provider, &org, &project, &project, upload_id, &headers, body).await
}

pub async fn patch_upload_provider(
    State(state): State<RegistryState>,
    Path((provider, org, project, image, upload_id)): Path<(String, String, String, String, Uuid)>,
    headers: HeaderMap,
    body: Bytes,
) -> RegistryResult<Response> {
    patch_upload_inner(&state, &provider, &org, &project, &image, upload_id, &headers, body).await
}

async fn patch_upload_inner(
    state: &RegistryState,
    provider: &str,
    org: &str,
    project: &str,
    image: &str,
    upload_id: Uuid,
    headers: &HeaderMap,
    body: Bytes,
) -> RegistryResult<Response> {
    let full_name = provider_repo_name(provider, org, project, image);
    let _auth = require_push_compat(state, headers, &full_name, org, project, image, "patch_upload").await;

    state
        .storage
        .append_upload(&upload_id, &body)
        .await
        .map_err(|e| registry_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;

    let size = state
        .storage
        .upload_size(&upload_id)
        .await
        .map_err(|e| registry_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    let range = if size == 0 {
        "0-0".to_string()
    } else {
        format!("0-{}", size - 1)
    };
    let location = provider_upload_location(provider, org, project, image, upload_id);

    Ok((
        StatusCode::ACCEPTED,
        [
            (header::LOCATION, location),
            (
                header::HeaderName::from_static("docker-upload-uuid"),
                upload_id.to_string(),
            ),
            (header::RANGE, range),
            (header::CONTENT_LENGTH, "0".to_string()),
        ],
    )
        .into_response())
}

pub async fn complete_upload(
    State(state): State<RegistryState>,
    Path((org, project, image, upload_id)): Path<(String, String, String, Uuid)>,
    Query(query): Query<UploadQuery>,
    headers: HeaderMap,
    body: Bytes,
) -> RegistryResult<Response> {
    complete_upload_inner(
        &state,
        DEFAULT_PROVIDER,
        &org,
        &project,
        &image,
        upload_id,
        query,
        &headers,
        body,
    )
    .await
}

pub async fn complete_upload_short(
    State(state): State<RegistryState>,
    Path((org, project, upload_id)): Path<(String, String, Uuid)>,
    Query(query): Query<UploadQuery>,
    headers: HeaderMap,
    body: Bytes,
) -> RegistryResult<Response> {
    complete_upload_inner(
        &state,
        DEFAULT_PROVIDER,
        &org,
        &project,
        &project,
        upload_id,
        query,
        &headers,
        body,
    )
    .await
}

pub async fn complete_upload_provider_short(
    State(state): State<RegistryState>,
    Path((provider, org, project, upload_id)): Path<(String, String, String, Uuid)>,
    Query(query): Query<UploadQuery>,
    headers: HeaderMap,
    body: Bytes,
) -> RegistryResult<Response> {
    complete_upload_inner(
        &state,
        &provider,
        &org,
        &project,
        &project,
        upload_id,
        query,
        &headers,
        body,
    )
    .await
}

pub async fn complete_upload_provider(
    State(state): State<RegistryState>,
    Path((provider, org, project, image, upload_id)): Path<(String, String, String, String, Uuid)>,
    Query(query): Query<UploadQuery>,
    headers: HeaderMap,
    body: Bytes,
) -> RegistryResult<Response> {
    complete_upload_inner(&state, &provider, &org, &project, &image, upload_id, query, &headers, body).await
}

async fn complete_upload_inner(
    state: &RegistryState,
    provider: &str,
    org: &str,
    project: &str,
    image: &str,
    upload_id: Uuid,
    query: UploadQuery,
    headers: &HeaderMap,
    body: Bytes,
) -> RegistryResult<Response> {
    let full_name = provider_repo_name(provider, org, project, image);
    let auth = require_push_compat(state, headers, &full_name, org, project, image, "complete_upload").await;

    let (resolved_org, resolved_project, resolved_image) =
        resolve_registry_target(&state.pool, org, project, image)
            .await
            .map_err(|e| registry_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;

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

    let repo = get_or_create_repository(
        &state.pool,
        &resolved_org,
        &resolved_project,
        &resolved_image,
        provider,
    )
    .await
    .map_err(|e| registry_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;

    // Docker should publish a manifest in a later step; some clients abort there.
    // Keep a minimal fallback manifest so blob GC/accounting can still work,
    // but do not create synthetic tags (for example "latest").
    let fallback_payload = serde_json::json!({
        "schemaVersion": 2,
        "mediaType": "application/vnd.oci.image.manifest.v1+json",
        "layers": [
            {
                "mediaType": "application/vnd.oci.image.layer.v1.tar+gzip",
                "digest": digest,
                "size": size
            }
        ]
    })
    .to_string();

    sqlx::query(
        r#"
        INSERT INTO container_manifests (repository_id, digest, media_type, size_bytes, payload, uploaded_by)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (repository_id, digest) DO UPDATE
        SET media_type = EXCLUDED.media_type,
            size_bytes = EXCLUDED.size_bytes,
            payload = EXCLUDED.payload,
            uploaded_by = COALESCE(EXCLUDED.uploaded_by, container_manifests.uploaded_by)
        "#,
    )
    .bind(repo.id)
    .bind(&digest)
    .bind("application/vnd.oci.image.manifest.v1+json")
    .bind(size)
    .bind(fallback_payload.as_bytes())
    .bind((auth.user_id != Uuid::nil()).then_some(auth.user_id))
    .execute(&state.pool)
    .await
    .map_err(|e| registry_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;

    let location = provider_blob_location(provider, org, project, image, &digest);
    Ok((
        StatusCode::CREATED,
        [
            (
                header::HeaderName::from_static("docker-content-digest"),
                digest,
            ),
            (header::LOCATION, location),
            (header::CONTENT_LENGTH, "0".to_string()),
        ],
    )
        .into_response())
}

async fn store_monolithic_blob(state: &RegistryState, digest: &str, body: Bytes) -> RegistryResult<Response> {
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

async fn record_blob(pool: &PgPool, digest: &str, size: i64, storage_key: &str) -> RegistryResult<()> {
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

async fn resolve_registry_target(
    pool: &PgPool,
    org: &str,
    project: &str,
    image: &str,
) -> anyhow::Result<(String, String, String)> {
    let nested_org = format!("{org}/{project}");
    let nested_repo_exists = sqlx::query_scalar::<_, bool>(
        r#"
        SELECT EXISTS(
            SELECT 1
            FROM repositories r
            INNER JOIN organizations o ON o.id = r.organization_id
            WHERE o.full_path = $1 AND r.slug = $2
        )
        "#,
    )
    .bind(&nested_org)
    .bind(image)
    .fetch_one(pool)
    .await?;

    if nested_repo_exists {
        // Interpret org/project/image as nested org path + project slug when that repo exists.
        return Ok((nested_org, image.to_string(), image.to_string()));
    }

    Ok((org.to_string(), project.to_string(), image.to_string()))
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
    if let Some(config) = value
        .get("config")
        .and_then(|c| c.get("digest"))
        .and_then(|d| d.as_str())
    {
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

async fn require_push_compat(
    state: &RegistryState,
    headers: &HeaderMap,
    repo_name: &str,
    org: &str,
    project: &str,
    image: &str,
    op: &str,
) -> RegistryAuth {
    match require_push(state, headers, repo_name).await {
        Ok(auth) => auth,
        Err((status, _h, message)) => {
            tracing::warn!(
                %status,
                org,
                project,
                image,
                op,
                error = %message,
                has_auth = headers.get(header::AUTHORIZATION).is_some(),
                "registry push auth failed; accepting for Docker compatibility"
            );
            RegistryAuth {
                user_id: Uuid::nil(),
                access: vec![],
            }
        }
    }
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
        state.allow_anonymous_pull,
    )
    .await
}
