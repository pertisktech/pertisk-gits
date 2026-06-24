use std::future::Future;
use std::path::PathBuf;
use std::pin::Pin;
use std::sync::Arc;

use axum::{
    body::Body,
    extract::{Path, Query, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Router,
};
use serde::Deserialize;
use sqlx::PgPool;
use uuid::Uuid;

use crate::access::{self, AuthUser};
use crate::config::repo_disk_path;
use crate::protocol;
use crate::storage::ensure_bare_repo;

#[derive(Clone)]
pub struct GitHttpState {
    pub pool: PgPool,
    pub repos_root: PathBuf,
    pub post_receive: Option<PostReceiveHook>,
}

pub type PostReceiveHook = Arc<
    dyn Fn(Uuid, PathBuf) -> Pin<Box<dyn Future<Output = ()> + Send + 'static>> + Send + Sync,
>;

#[derive(Debug, Deserialize)]
struct InfoRefsQuery {
    service: Option<String>,
}

pub fn router() -> Router<GitHttpState> {
    Router::new()
        .route("/{org}/{repo}/info/refs", get(info_refs))
        .route("/{org}/{repo}/git-upload-pack", post(upload_pack))
        .route("/{org}/{repo}/git-receive-pack", post(receive_pack))
}

async fn info_refs(
    State(state): State<GitHttpState>,
    Path((org, repo)): Path<(String, String)>,
    Query(query): Query<InfoRefsQuery>,
    headers: HeaderMap,
) -> Result<Response, GitHttpError> {
    let repo = load_repo(&state, &org, &repo).await?;
    let user = authenticate(&state.pool, &headers).await?;

    if !access::can_read_repo(&state.pool, &repo, user.as_ref())
        .await
        .map_err(|e| GitHttpError::Internal(e.to_string()))?
    {
        return Err(GitHttpError::Unauthorized);
    }

    let Some(service) = query.service.as_deref() else {
        return Err(GitHttpError::BadRequest(
            "missing service query parameter".into(),
        ));
    };

    let disk_path = repo_disk_path(&state.repos_root, &org, &repo.repo_slug);
    ensure_bare_repo(&state.repos_root, &org, &repo.repo_slug)
        .await
        .map_err(|e| GitHttpError::Internal(e.to_string()))?;

    let body = protocol::advertise_refs(&disk_path, service)
        .await
        .map_err(|e| GitHttpError::Internal(e.to_string()))?;

    let content_type = match service {
        "git-upload-pack" => "application/x-git-upload-pack-advertisement",
        "git-receive-pack" => "application/x-git-receive-pack-advertisement",
        _ => return Err(GitHttpError::BadRequest("unsupported service".into())),
    };

    Ok((
        StatusCode::OK,
        [(header::CONTENT_TYPE, content_type)],
        body,
    )
        .into_response())
}

async fn upload_pack(
    State(state): State<GitHttpState>,
    Path((org, repo)): Path<(String, String)>,
    headers: HeaderMap,
    body: Body,
) -> Result<Response, GitHttpError> {
    let repo = load_repo(&state, &org, &repo).await?;
    let user = authenticate(&state.pool, &headers).await?;

    if !access::can_read_repo(&state.pool, &repo, user.as_ref())
        .await
        .map_err(|e| GitHttpError::Internal(e.to_string()))?
    {
        return Err(GitHttpError::Unauthorized);
    }

    let disk_path = repo_disk_path(&state.repos_root, &org, &repo.repo_slug);
    let request_body = axum::body::to_bytes(body, 50 * 1024 * 1024)
        .await
        .map_err(|e| GitHttpError::Internal(e.to_string()))?;

    let response_body = protocol::stateless_rpc(&disk_path, "git-upload-pack", &request_body)
        .await
        .map_err(|e| GitHttpError::Internal(e.to_string()))?;

    Ok((
        StatusCode::OK,
        [(header::CONTENT_TYPE, "application/x-git-upload-pack-result")],
        response_body,
    )
        .into_response())
}

async fn receive_pack(
    State(state): State<GitHttpState>,
    Path((org, repo)): Path<(String, String)>,
    headers: HeaderMap,
    body: Body,
) -> Result<Response, GitHttpError> {
    let repo = load_repo(&state, &org, &repo).await?;
    let user = authenticate(&state.pool, &headers)
        .await?
        .ok_or(GitHttpError::Unauthorized)?;

    if !access::can_write_repo(&state.pool, &repo, &user)
        .await
        .map_err(|e| GitHttpError::Internal(e.to_string()))?
    {
        return Err(GitHttpError::Forbidden);
    }

    let disk_path = repo_disk_path(&state.repos_root, &org, &repo.repo_slug);
    ensure_bare_repo(&state.repos_root, &org, &repo.repo_slug)
        .await
        .map_err(|e| GitHttpError::Internal(e.to_string()))?;

    let request_body = axum::body::to_bytes(body, 50 * 1024 * 1024)
        .await
        .map_err(|e| GitHttpError::Internal(e.to_string()))?;

    let response_body = protocol::stateless_rpc(&disk_path, "git-receive-pack", &request_body)
        .await
        .map_err(|e| GitHttpError::Internal(e.to_string()))?;

    if let Some(hook) = &state.post_receive {
        let hook = hook.clone();
        let repo_id = repo.id;
        let path = disk_path.clone();
        tokio::spawn(async move {
            hook(repo_id, path).await;
        });
    }

    Ok((
        StatusCode::OK,
        [(header::CONTENT_TYPE, "application/x-git-receive-pack-result")],
        response_body,
    )
        .into_response())
}

async fn load_repo(
    state: &GitHttpState,
    org: &str,
    repo: &str,
) -> Result<access::RepoRecord, GitHttpError> {
    let repo_slug = repo.strip_suffix(".git").unwrap_or(repo);
    access::find_repo(&state.pool, org, repo_slug)
        .await
        .map_err(|e| GitHttpError::Internal(e.to_string()))?
        .ok_or(GitHttpError::NotFound)
}

async fn authenticate(pool: &PgPool, headers: &HeaderMap) -> Result<Option<AuthUser>, GitHttpError> {
    let Some(header_value) = headers.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok()) else {
        return Ok(None);
    };

    let Some((username, password)) = access::parse_basic_auth(header_value) else {
        return Ok(None);
    };

    access::authenticate_basic(pool, &username, &password)
        .await
        .map_err(|e| GitHttpError::Internal(e.to_string()))
}

enum GitHttpError {
    NotFound,
    Unauthorized,
    Forbidden,
    BadRequest(String),
    Internal(String),
}

impl IntoResponse for GitHttpError {
    fn into_response(self) -> Response {
        match self {
            GitHttpError::NotFound => StatusCode::NOT_FOUND.into_response(),
            GitHttpError::Unauthorized => (
                StatusCode::UNAUTHORIZED,
                [(header::WWW_AUTHENTICATE, "Basic realm=\"Pertisk Gits\"")],
            )
                .into_response(),
            GitHttpError::Forbidden => StatusCode::FORBIDDEN.into_response(),
            GitHttpError::BadRequest(msg) => (StatusCode::BAD_REQUEST, msg).into_response(),
            GitHttpError::Internal(msg) => {
                tracing::error!("git http error: {msg}");
                StatusCode::INTERNAL_SERVER_ERROR.into_response()
            }
        }
    }
}
