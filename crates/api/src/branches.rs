use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::post,
    Json, Router,
};
use pertisk_domain::DomainError;
use pertisk_git::{explorer, RefUpdate};
use serde::Deserialize;

use crate::{
    branch_protection, cicd, ensure_can_write_repo, load_repo_for_read, map_explorer_error, ApiError,
    AppState, AuthUser,
};

pub fn branches_write_routes() -> Router<AppState> {
    Router::new()
        .route(
            "/organizations/{org_path}/repositories/{repo_slug}/branches",
            post(create_repo_branch),
        )
        .route(
            "/organizations/{org_path}/repositories/{repo_slug}/branches/{*branch_name}",
            axum::routing::delete(delete_repo_branch),
        )
}

#[derive(Debug, Deserialize)]
struct CreateBranchRequest {
    name: String,
    #[serde(default)]
    source_ref: Option<String>,
}

#[derive(serde::Serialize)]
struct CreateBranchResponse {
    branch: explorer::BranchInfo,
}

async fn create_repo_branch(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_path, repo_slug)): Path<(String, String)>,
    Json(body): Json<CreateBranchRequest>,
) -> Result<(StatusCode, Json<CreateBranchResponse>), ApiError> {
    let name = body.name.trim();
    if name.is_empty() {
        return Err(DomainError::Validation("branch name is required".into()).into());
    }

    let org_path = crate::org::org_path_from_param(&org_path);
    let (_org, repo, repo_path) =
        load_repo_for_read(&state, &org_path, &repo_slug, Some(&auth)).await?;
    ensure_can_write_repo(&state, &org_path, &repo, &auth).await?;

    let source = body
        .source_ref
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(repo.default_branch.as_str());

    let branch = explorer::create_branch(&repo_path, name, source)
        .await
        .map_err(map_explorer_error)?;

    let branch_ref = format!("refs/heads/{name}");
    let updates = vec![RefUpdate {
        ref_name: branch_ref,
        old_sha: None,
        new_sha: branch.sha.clone(),
    }];

    let hook_state = state.clone();
    let repo_id = repo.id;
    let repo_path_buf = repo_path.clone();
    tokio::spawn(async move {
        cicd::post_receive_hook(hook_state)(repo_id, repo_path_buf, updates).await;
    });

    Ok((
        StatusCode::CREATED,
        Json(CreateBranchResponse { branch }),
    ))
}

async fn delete_repo_branch(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_path, repo_slug, branch_name)): Path<(String, String, String)>,
) -> Result<StatusCode, ApiError> {
    let name = branch_name.trim();
    if name.is_empty() {
        return Err(DomainError::Validation("branch name is required".into()).into());
    }

    let org_path = crate::org::org_path_from_param(&org_path);
    let (_org, repo, repo_path) =
        load_repo_for_read(&state, &org_path, &repo_slug, Some(&auth)).await?;
    ensure_can_write_repo(&state, &org_path, &repo, &auth).await?;

    if name == repo.default_branch {
        return Err(DomainError::Validation(
            "cannot delete the default branch".into(),
        )
        .into());
    }

    let branch_ref = format!("refs/heads/{name}");
    let old_sha = explorer::branch_head_sha(&repo_path, name)
        .await
        .map_err(map_explorer_error)?;

    branch_protection::validate_push_updates(
        &state.pool,
        repo.id,
        auth.user_id,
        &repo_path,
        &[(old_sha.clone(), "0".repeat(40), branch_ref.clone())],
    )
    .await
    .map_err(|message| ApiError::from(DomainError::Validation(message)))?;

    explorer::delete_branch(&repo_path, name)
        .await
        .map_err(map_explorer_error)?;

    let updates = vec![RefUpdate {
        ref_name: branch_ref,
        old_sha: Some(old_sha),
        new_sha: "0".repeat(40),
    }];

    let hook_state = state.clone();
    let repo_id = repo.id;
    let repo_path_buf = repo_path.clone();
    tokio::spawn(async move {
        cicd::post_receive_hook(hook_state)(repo_id, repo_path_buf, updates).await;
    });

    Ok(StatusCode::NO_CONTENT)
}
