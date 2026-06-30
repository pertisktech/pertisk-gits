use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::post,
    Json, Router,
};
use pertisk_domain::{models::*, DomainError};
use pertisk_git::{editor, RefUpdate};
use serde::{Deserialize, Serialize};
use tokio::process::Command;

use crate::{
    branch_protection, cicd, ensure_can_write_repo, load_repo_for_read, map_explorer_error, ApiError,
    AppState, AuthUser,
};

pub fn contents_routes() -> Router<AppState> {
    Router::new().route(
        "/organizations/{org_path}/repositories/{repo_slug}/contents",
        post(commit_contents),
    )
}

#[derive(Debug, Deserialize)]
struct CommitContentsRequest {
    branch: String,
    message: String,
    changes: Vec<FileChangeInput>,
}

#[derive(Debug, Deserialize)]
struct FileChangeInput {
    path: String,
    content: Option<String>,
}

#[derive(Serialize)]
struct CommitContentsResponse {
    commit_sha: String,
    short_sha: String,
}

async fn commit_contents(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_path, repo_slug)): Path<(String, String)>,
    Json(body): Json<CommitContentsRequest>,
) -> Result<(StatusCode, Json<CommitContentsResponse>), ApiError> {
    if body.message.trim().is_empty() {
        return Err(DomainError::Validation("message is required".into()).into());
    }

    if body.changes.is_empty() {
        return Err(DomainError::Validation("changes is required".into()).into());
    }

    let (_org, repo, repo_path) =
        load_repo_for_read(&state, &crate::org::org_path_from_param(&org_path), &repo_slug, Some(&auth)).await?;
    ensure_can_write_repo(&state, &crate::org::org_path_from_param(&org_path), &repo, &auth).await?;

    let branch = body.branch.trim();
    if branch.is_empty() {
        return Err(DomainError::Validation("branch is required".into()).into());
    }

    let branch_ref = format!("refs/heads/{branch}");
    let old_sha = rev_parse_optional(&repo_path, &branch_ref).await?;

    if let Some(ref sha) = old_sha {
        // Web commits are always fast-forward; validate protection rules before writing.
        branch_protection::validate_push_updates(
            &state.pool,
            repo.id,
            auth.user_id,
            &repo_path,
            &[(sha.clone(), sha.clone(), branch_ref.clone())],
        )
        .await
        .map_err(|msg| ApiError::from(DomainError::Validation(msg)))?;
    }

    let author = fetch_commit_author(&state, auth.user_id).await?;

    let changes: Vec<editor::FileChange> = body
        .changes
        .into_iter()
        .map(|change| editor::FileChange {
            path: change.path,
            content: change.content,
        })
        .collect();

    let commit_sha = match editor::commit_files(
        &repo_path,
        branch,
        &author,
        body.message.trim(),
        &changes,
    )
    .await
    {
        Ok(sha) => sha,
        Err(err) => {
            tracing::error!(error = %err, branch, repo = %repo.slug, "commit_contents failed");
            return Err(map_explorer_error(err));
        }
    };

    let updates = vec![RefUpdate {
        ref_name: branch_ref,
        old_sha,
        new_sha: commit_sha.clone(),
    }];

    let hook_state = state.clone();
    let repo_id = repo.id;
    let repo_path_buf = repo_path.clone();
    tokio::spawn(async move {
        cicd::post_receive_hook(hook_state)(repo_id, repo_path_buf, updates).await;
    });

    Ok((
        StatusCode::CREATED,
        Json(CommitContentsResponse {
            short_sha: commit_sha.chars().take(7).collect(),
            commit_sha,
        }),
    ))
}

async fn rev_parse_optional(
    repo_path: &std::path::Path,
    reference: &str,
) -> Result<Option<String>, ApiError> {
    let output = Command::new("git")
        .arg(format!("--git-dir={}", repo_path.display()))
        .args(["rev-parse", reference])
        .output()
        .await
        .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    if !output.status.success() {
        return Ok(None);
    }

    Ok(Some(
        String::from_utf8_lossy(&output.stdout).trim().to_string(),
    ))
}

async fn fetch_commit_author(
    state: &AppState,
    user_id: uuid::Uuid,
) -> Result<editor::CommitAuthor, ApiError> {
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

    Ok(editor::CommitAuthor {
        name,
        email: row.1,
    })
}
