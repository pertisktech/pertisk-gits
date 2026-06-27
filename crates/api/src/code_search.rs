use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;

use axum::{
    extract::{Path, Query, State},
    routing::get,
    Json, Router,
};
use pertisk_domain::DomainError;
use pertisk_search::{search_code, CodeSearchHit, CodeSearchOptions};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

use crate::{load_repo_for_read, ApiError, AppState, AuthUser, OptionalAuth};

pub fn code_search_read_routes() -> Router<AppState> {
    Router::new()
        .route("/search/code", get(global_code_search))
        .route(
            "/organizations/{org_slug}/repositories/{repo_slug}/search/code",
            get(repo_code_search),
        )
        .route(
            "/organizations/{org_slug}/repositories/{repo_slug}/search/status",
            get(repo_search_status),
        )
}

#[derive(Deserialize)]
struct SearchQuery {
    q: String,
    #[serde(default = "default_limit")]
    limit: usize,
}

fn default_limit() -> usize {
    20
}

#[derive(Serialize)]
struct CodeSearchResponse {
    query: String,
    hits: Vec<CodeSearchHit>,
}

#[derive(Serialize)]
struct CodeSearchStatusResponse {
    indexed: bool,
    commit_sha: Option<String>,
    ref_name: Option<String>,
    document_count: Option<i32>,
    indexed_at: Option<chrono::DateTime<chrono::Utc>>,
}

pub fn spawn_background_processor(pool: PgPool, repos_root: PathBuf, index_root: Arc<PathBuf>) {
    tokio::spawn(async move {
        use std::time::Duration;

        let repos_root = Arc::new(repos_root);
        pertisk_worker::search::ensure_index_root(&index_root).ok();
        let worker = pertisk_worker::search::CodeIndexWorker::new(pool, repos_root, index_root);

        let poll_secs = std::env::var("WORKER_POLL_SECS")
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(2);

        tracing::info!("code search index processor started");

        loop {
            match worker.process_pending_jobs().await {
                Ok(count) if count > 0 => {
                    tracing::info!(processed = count, "code index jobs processed")
                }
                Ok(_) => {}
                Err(err) => tracing::warn!("code index processing failed: {err:#}"),
            }
            tokio::time::sleep(Duration::from_secs(poll_secs)).await;
        }
    });
}

async fn global_code_search(
    State(state): State<AppState>,
    OptionalAuth(auth): OptionalAuth,
    Query(query): Query<SearchQuery>,
) -> Result<Json<CodeSearchResponse>, ApiError> {
    let allowed = searchable_repository_ids(&state.pool, auth.as_ref()).await?;
    let hits = run_search(&state, &query.q, None, Some(&allowed), query.limit)?;
    Ok(Json(CodeSearchResponse {
        query: query.q,
        hits,
    }))
}

async fn repo_code_search(
    State(state): State<AppState>,
    OptionalAuth(auth): OptionalAuth,
    Path((org_slug, repo_slug)): Path<(String, String)>,
    Query(query): Query<SearchQuery>,
) -> Result<Json<CodeSearchResponse>, ApiError> {
    let (_org, repo, _path) =
        load_repo_for_read(&state, &org_slug, &repo_slug, auth.as_ref()).await?;

    let hits = run_search(&state, &query.q, Some(repo.id), None, query.limit)?;
    Ok(Json(CodeSearchResponse {
        query: query.q,
        hits,
    }))
}

async fn repo_search_status(
    State(state): State<AppState>,
    OptionalAuth(auth): OptionalAuth,
    Path((org_slug, repo_slug)): Path<(String, String)>,
) -> Result<Json<CodeSearchStatusResponse>, ApiError> {
    let (_org, repo, _path) =
        load_repo_for_read(&state, &org_slug, &repo_slug, auth.as_ref()).await?;

    let row = sqlx::query_as::<_, IndexMetaRow>(
        r#"
        SELECT commit_sha, ref_name, document_count, indexed_at
        FROM code_search_index_meta
        WHERE repository_id = $1
        "#,
    )
    .bind(repo.id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    Ok(Json(match row {
        Some(meta) => CodeSearchStatusResponse {
            indexed: meta.document_count > 0,
            commit_sha: Some(meta.commit_sha),
            ref_name: Some(meta.ref_name),
            document_count: Some(meta.document_count),
            indexed_at: Some(meta.indexed_at),
        },
        None => CodeSearchStatusResponse {
            indexed: false,
            commit_sha: None,
            ref_name: None,
            document_count: None,
            indexed_at: None,
        },
    }))
}

fn run_search(
    state: &AppState,
    query: &str,
    repository_id: Option<Uuid>,
    allowed_repository_ids: Option<&HashSet<Uuid>>,
    limit: usize,
) -> Result<Vec<CodeSearchHit>, ApiError> {
    let limit = limit.clamp(1, 50);
    search_code(CodeSearchOptions {
        index_root: &state.config.search_index_root,
        query,
        repository_id,
        allowed_repository_ids,
        limit,
    })
    .map_err(|err| ApiError::from(DomainError::Internal(err.to_string())))
}

async fn searchable_repository_ids(
    pool: &PgPool,
    auth: Option<&AuthUser>,
) -> Result<HashSet<Uuid>, ApiError> {
    let rows = match auth {
        Some(user) => {
            sqlx::query_scalar::<_, Uuid>(
                r#"
                SELECT DISTINCT r.id
                FROM repositories r
                LEFT JOIN organizations o ON o.id = r.organization_id
                WHERE r.visibility = 'public'
                   OR EXISTS (
                        SELECT 1 FROM organization_members om
                        WHERE om.organization_id = r.organization_id AND om.user_id = $1
                   )
                   OR EXISTS (
                        SELECT 1 FROM repository_permissions rp
                        WHERE rp.repository_id = r.id AND rp.user_id = $1
                   )
                "#,
            )
            .bind(user.user_id)
            .fetch_all(pool)
            .await
        }
        None => {
            sqlx::query_scalar::<_, Uuid>(
                r#"
                SELECT id FROM repositories WHERE visibility = 'public'
                "#,
            )
            .fetch_all(pool)
            .await
        }
    }
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    Ok(rows.into_iter().collect())
}

#[derive(sqlx::FromRow)]
struct IndexMetaRow {
    commit_sha: String,
    ref_name: String,
    document_count: i32,
    indexed_at: chrono::DateTime<chrono::Utc>,
}
