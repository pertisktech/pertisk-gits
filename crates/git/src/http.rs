use std::future::Future;
use std::path::PathBuf;
use std::pin::Pin;
use std::sync::Arc;

use axum::{
    body::Body,
    extract::{Query, State},
    http::{header, HeaderMap, Method, Request, StatusCode},
    response::{IntoResponse, Response},
    Router,
};
use serde::Deserialize;
use sqlx::PgPool;
use uuid::Uuid;

use pertisk_domain::split_git_repo_path;

use crate::access::{self, AuthUser};
use crate::config::repo_disk_path;
use crate::protocol;
use crate::refs::{diff_refs, snapshot_refs};
use crate::storage::{ensure_bare_repo, ensure_bare_repo_refs_dirs, repo_exists_on_disk};

#[derive(Clone)]
pub struct GitHttpState {
    pub pool: PgPool,
    pub repos_root: PathBuf,
    pub post_receive: Option<PostReceiveHook>,
    pub validate_push: Option<ValidatePushHook>,
    pub push_hints: Option<PushHintHook>,
}

pub type PostReceiveHook = Arc<
    dyn Fn(Uuid, PathBuf, Vec<crate::refs::RefUpdate>) -> Pin<Box<dyn Future<Output = ()> + Send + 'static>>
        + Send
        + Sync,
>;

pub type ValidatePushHook = Arc<
    dyn Fn(Uuid, Uuid, PathBuf, Vec<(String, String, String)>) -> Pin<Box<dyn Future<Output = Result<(), String>> + Send + 'static>>
        + Send
        + Sync,
>;

pub type PushHintHook = Arc<
    dyn Fn(Uuid, Vec<crate::refs::RefUpdate>) -> Pin<Box<dyn Future<Output = Vec<String>> + Send + 'static>>
        + Send
        + Sync,
>;

#[derive(Debug, Deserialize)]
struct InfoRefsQuery {
    service: Option<String>,
}

#[derive(Debug, Clone, Copy)]
enum GitHttpService {
    InfoRefs,
    UploadPack,
    ReceivePack,
}

/// True for Git smart HTTP endpoints (`.../info/refs`, `.../git-upload-pack`, etc.).
pub fn is_smart_http_path(path: &str) -> bool {
    let path = path.trim_start_matches('/');
    path.ends_with("/info/refs")
        || path.ends_with("/git-upload-pack")
        || path.ends_with("/git-receive-pack")
}

/// Standalone git-http server: catch-all is fine (no SPA).
pub fn router() -> Router<GitHttpState> {
    Router::new().fallback(handle)
}

/// Handle a Git smart HTTP request (used by pertisk-api middleware and git-http binary).
pub async fn handle(state: State<GitHttpState>, req: Request<Body>) -> Response {
    match serve(state, req).await {
        Ok(response) => response,
        Err(err) => err.into_response(),
    }
}

async fn serve(
    State(state): State<GitHttpState>,
    req: Request<Body>,
) -> Result<Response, GitHttpError> {
    let git_path = req.uri().path().trim_start_matches('/');
    let (org_path, repo, service) = parse_git_http_path(git_path)?;
    let org_path = org_path.to_string();
    let repo = repo.to_string();
    let headers = req.headers().clone();
    let method = req.method().clone();
    let uri = req.uri().clone();

    match method {
        Method::GET | Method::HEAD => match service {
            GitHttpService::InfoRefs => {
                let query = Query::<InfoRefsQuery>::try_from_uri(&uri)
                    .map_err(|_| GitHttpError::BadRequest("invalid query".into()))?
                    .0;
                info_refs(State(state), &org_path, &repo, query, headers).await
            }
            _ => Err(GitHttpError::NotFound),
        },
        Method::POST => {
            let body = req.into_body();
            match service {
                GitHttpService::UploadPack => {
                    upload_pack(State(state), &org_path, &repo, headers, body).await
                }
                GitHttpService::ReceivePack => {
                    receive_pack(State(state), &org_path, &repo, headers, body).await
                }
                _ => Err(GitHttpError::NotFound),
            }
        }
        _ => Err(GitHttpError::NotFound),
    }
}

/// Parse `a/b/c/repo.git/info/refs` (catch-all at end of route).
fn parse_git_http_path(full_path: &str) -> Result<(&str, &str, GitHttpService), GitHttpError> {
    let full_path = full_path.trim_start_matches('/');
    let (repo_path, service) = if let Some(base) = full_path.strip_suffix("/info/refs") {
        (base, GitHttpService::InfoRefs)
    } else if let Some(base) = full_path.strip_suffix("/git-upload-pack") {
        (base, GitHttpService::UploadPack)
    } else if let Some(base) = full_path.strip_suffix("/git-receive-pack") {
        (base, GitHttpService::ReceivePack)
    } else {
        return Err(GitHttpError::NotFound);
    };

    let (org_path, repo) = split_git_repo_path(repo_path).ok_or(GitHttpError::NotFound)?;
    Ok((org_path, repo, service))
}

async fn info_refs(
    State(state): State<GitHttpState>,
    org_path: &str,
    repo: &str,
    query: InfoRefsQuery,
    headers: HeaderMap,
) -> Result<Response, GitHttpError> {
    let repo = load_repo(&state, org_path, repo).await?;
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

    if !repo_exists_on_disk(&state.repos_root, org_path, &repo.repo_slug) {
        return Err(GitHttpError::NotFound);
    }

    let disk_path = repo_disk_path(&state.repos_root, org_path, &repo.repo_slug);
    ensure_bare_repo_refs_dirs(&disk_path).map_err(|e| GitHttpError::Internal(e.to_string()))?;

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
    org_path: &str,
    repo: &str,
    headers: HeaderMap,
    body: Body,
) -> Result<Response, GitHttpError> {
    let repo = load_repo(&state, org_path, repo).await?;
    let user = authenticate(&state.pool, &headers).await?;

    if !access::can_read_repo(&state.pool, &repo, user.as_ref())
        .await
        .map_err(|e| GitHttpError::Internal(e.to_string()))?
    {
        return Err(GitHttpError::Unauthorized);
    }

    if !repo_exists_on_disk(&state.repos_root, org_path, &repo.repo_slug) {
        return Err(GitHttpError::NotFound);
    }

    let disk_path = repo_disk_path(&state.repos_root, org_path, &repo.repo_slug);
    ensure_bare_repo_refs_dirs(&disk_path).map_err(|e| GitHttpError::Internal(e.to_string()))?;

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
    org_path: &str,
    repo: &str,
    headers: HeaderMap,
    body: Body,
) -> Result<Response, GitHttpError> {
    let repo = load_repo(&state, org_path, repo).await?;
    let user = authenticate(&state.pool, &headers)
        .await?
        .ok_or(GitHttpError::Unauthorized)?;

    if !access::can_write_repo(&state.pool, &repo, &user)
        .await
        .map_err(|e| GitHttpError::Internal(e.to_string()))?
    {
        return Err(GitHttpError::Forbidden);
    }

    let disk_path = repo_disk_path(&state.repos_root, org_path, &repo.repo_slug);
    ensure_bare_repo(&state.repos_root, org_path, &repo.repo_slug)
        .await
        .map_err(|e| GitHttpError::Internal(e.to_string()))?;

    let request_body = axum::body::to_bytes(body, 50 * 1024 * 1024)
        .await
        .map_err(|e| GitHttpError::Internal(e.to_string()))?;

    let push_updates = protocol::parse_receive_pack_commands(&request_body);
    if !push_updates.is_empty() {
        if let Some(validate) = &state.validate_push {
            validate(
                repo.id,
                user.id,
                disk_path.clone(),
                push_updates.clone(),
            )
            .await
            .map_err(GitHttpError::ForbiddenMessage)?;
        }
    }

    let refs_before = snapshot_refs(&disk_path)
        .await
        .map_err(|e| GitHttpError::Internal(e.to_string()))?;

    let response_body = protocol::stateless_rpc(&disk_path, "git-receive-pack", &request_body)
        .await
        .map_err(|e| GitHttpError::Internal(e.to_string()))?;

    let refs_after = snapshot_refs(&disk_path)
        .await
        .map_err(|e| GitHttpError::Internal(e.to_string()))?;
    let ref_updates = diff_refs(&refs_before, &refs_after);

    let mut response_body = response_body;
    if !ref_updates.is_empty() {
        if let Some(hints_hook) = &state.push_hints {
            let hints = hints_hook(repo.id, ref_updates.clone()).await;
            if !hints.is_empty() && protocol::receive_pack_supports_sideband(&request_body) {
                response_body =
                    protocol::append_receive_pack_sideband_messages(response_body, &hints);
            }
        }
    }

    if let Some(hook) = &state.post_receive {
        let hook = hook.clone();
        let repo_id = repo.id;
        let path = disk_path.clone();
        let updates = ref_updates;
        tokio::spawn(async move {
            if !updates.is_empty() {
                hook(repo_id, path, updates).await;
            }
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

    if let Some(token) = header_value.strip_prefix("Bearer ") {
        let token = token.trim();
        if !token.is_empty() {
            if let Some(user) = access::authenticate_api_token(pool, token)
                .await
                .map_err(|e| GitHttpError::Internal(e.to_string()))?
            {
                return Ok(Some(user));
            }
        }
    }

    let Some((username, password)) = access::parse_basic_auth(header_value) else {
        return Ok(None);
    };

    if let Some(user) = access::authenticate_basic(pool, &username, &password)
        .await
        .map_err(|e| GitHttpError::Internal(e.to_string()))?
    {
        return Ok(Some(user));
    }

    if username == "x-access-token" || username == "oauth2" || password.starts_with("pgs_") {
        if let Some(user) = access::authenticate_api_token(pool, &password)
            .await
            .map_err(|e| GitHttpError::Internal(e.to_string()))?
        {
            return Ok(Some(user));
        }
    }

    Ok(None)
}

#[derive(Debug)]
enum GitHttpError {
    NotFound,
    Unauthorized,
    Forbidden,
    ForbiddenMessage(String),
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
            GitHttpError::ForbiddenMessage(msg) => (StatusCode::FORBIDDEN, msg).into_response(),
            GitHttpError::BadRequest(msg) => (StatusCode::BAD_REQUEST, msg).into_response(),
            GitHttpError::Internal(msg) => {
                tracing::error!("git http error: {msg}");
                StatusCode::INTERNAL_SERVER_ERROR.into_response()
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn smart_http_paths() {
        assert!(is_smart_http_path("acme/repo.git/info/refs"));
        assert!(is_smart_http_path("/acme/repo.git/git-upload-pack"));
        assert!(is_smart_http_path("org/repo.git/git-receive-pack"));
        assert!(!is_smart_http_path("acme/repo"));
        assert!(!is_smart_http_path("/api/health"));
    }

    #[test]
    fn parse_git_http_path_splits_org_and_service() {
        let (org, repo, service) =
            parse_git_http_path("acme/widget.git/info/refs").unwrap();
        assert_eq!(org, "acme");
        assert_eq!(repo, "widget");
        assert!(matches!(service, GitHttpService::InfoRefs));

        let (org, repo, service) =
            parse_git_http_path("a/b/c/repo.git/git-upload-pack").unwrap();
        assert_eq!(org, "a/b/c");
        assert_eq!(repo, "repo");
        assert!(matches!(service, GitHttpService::UploadPack));

        assert!(parse_git_http_path("acme/repo/unknown").is_err());
    }

    #[test]
    fn parse_receive_pack_service() {
        let (_, repo, service) =
            parse_git_http_path("team/app.git/git-receive-pack").unwrap();
        assert_eq!(repo, "app");
        assert!(matches!(service, GitHttpService::ReceivePack));
    }

    #[test]
    fn git_http_error_status_codes() {
        use axum::response::IntoResponse;
        assert_eq!(
            GitHttpError::NotFound.into_response().status(),
            StatusCode::NOT_FOUND
        );
        assert_eq!(
            GitHttpError::Unauthorized.into_response().status(),
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            GitHttpError::Forbidden.into_response().status(),
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            GitHttpError::BadRequest("bad".into()).into_response().status(),
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            GitHttpError::ForbiddenMessage("nope".into())
                .into_response()
                .status(),
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            GitHttpError::Internal("boom".into()).into_response().status(),
            StatusCode::INTERNAL_SERVER_ERROR
        );
    }
}
