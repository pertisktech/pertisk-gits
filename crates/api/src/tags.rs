use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::post,
    Json, Router,
};
use pertisk_domain::DomainError;
use pertisk_git::{explorer, RefUpdate};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    cicd, ensure_can_write_repo, load_repo_for_read, map_explorer_error, ApiError, AppState,
    AuthUser,
};

pub fn tags_write_routes() -> Router<AppState> {
    Router::new().route(
        "/organizations/{org_path}/repositories/{repo_slug}/tags",
        post(create_repo_tag),
    )
}

#[derive(Debug, Deserialize)]
struct CreateTagRequest {
    name: String,
    #[serde(default)]
    target_ref: Option<String>,
    #[serde(default)]
    message: Option<String>,
}

#[derive(Serialize)]
struct CreateTagResponse {
    tag: explorer::TagInfo,
}

async fn create_repo_tag(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_path, repo_slug)): Path<(String, String)>,
    Json(body): Json<CreateTagRequest>,
) -> Result<(StatusCode, Json<CreateTagResponse>), ApiError> {
    let name = body.name.trim();
    if name.is_empty() {
        return Err(DomainError::Validation("tag name is required".into()).into());
    }

    let (_org, repo, repo_path) =
        load_repo_for_read(&state, &crate::org::org_path_from_param(&org_path), &repo_slug, Some(&auth)).await?;
    ensure_can_write_repo(&state, &crate::org::org_path_from_param(&org_path), &repo, &auth).await?;

    let target = body
        .target_ref
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(repo.default_branch.as_str());

    let tagger = fetch_tagger_identity(&state, auth.user_id).await?;
    let message = body
        .message
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(name);

    let tag = explorer::create_tag(
        &repo_path,
        name,
        target,
        Some(message),
        Some(explorer::TaggerIdentity {
            name: tagger.name.as_str(),
            email: tagger.email.as_str(),
        }),
    )
    .await
    .map_err(map_explorer_error)?;

    let tag_ref = format!("refs/tags/{name}");
    let new_sha = rev_parse(&repo_path, &tag_ref).await?;
    let updates = vec![RefUpdate {
        ref_name: tag_ref,
        old_sha: None,
        new_sha,
    }];

    let hook_state = state.clone();
    let repo_id = repo.id;
    let repo_path_buf = repo_path.clone();
    tokio::spawn(async move {
        cicd::post_receive_hook(hook_state)(repo_id, repo_path_buf, updates).await;
    });

    Ok((
        StatusCode::CREATED,
        Json(CreateTagResponse { tag }),
    ))
}

struct TaggerIdentity {
    name: String,
    email: String,
}

async fn fetch_tagger_identity(
    state: &AppState,
    user_id: Uuid,
) -> Result<TaggerIdentity, ApiError> {
    let row = sqlx::query_as::<_, (Option<String>, String, String)>(
        "SELECT display_name, email, username FROM users WHERE id = $1",
    )
    .bind(user_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?
    .ok_or(DomainError::NotFound)?;

    let name = row
        .0
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| row.2.clone());

    Ok(TaggerIdentity {
        name,
        email: row.1,
    })
}

async fn rev_parse(repo_path: &std::path::Path, reference: &str) -> Result<String, ApiError> {
    let output = tokio::process::Command::new("git")
        .arg(format!("--git-dir={}", repo_path.display()))
        .args(["rev-parse", reference])
        .output()
        .await
        .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    if !output.status.success() {
        return Err(DomainError::Internal(format!(
            "failed to resolve reference '{reference}'"
        ))
        .into());
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}
