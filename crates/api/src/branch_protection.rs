use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{get, patch, post},
    Json, Router,
};
use pertisk_domain::{branch_matches_pattern, models::*, DomainError};
use sqlx::PgPool;
use uuid::Uuid;
use validator::Validate;

use crate::{permissions, ApiError, AppState, AuthUser};

pub fn branch_protection_read_routes() -> Router<AppState> {
    Router::new().route(
        "/organizations/{org_path}/repositories/{repo_slug}/branch-protection",
        get(list_branch_protection_rules),
    )
}

pub fn branch_protection_write_routes() -> Router<AppState> {
    Router::new()
        .route(
            "/organizations/{org_path}/repositories/{repo_slug}/branch-protection",
            post(create_branch_protection_rule),
        )
        .route(
            "/organizations/{org_path}/repositories/{repo_slug}/branch-protection/{rule_id}",
            patch(update_branch_protection_rule).delete(delete_branch_protection_rule),
        )
}

async fn list_branch_protection_rules(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_path, repo_slug)): Path<(String, String)>,
) -> Result<Json<Vec<BranchProtectionRule>>, ApiError> {
    let (org, repo) = load_repo(&state.pool, &crate::org::org_path_from_param(&org_path), &repo_slug).await?;
    permissions::ensure_can_admin_repo(&state.pool, org.id, &repo, &auth).await?;

    let rules = sqlx::query_as::<_, BranchProtectionRule>(
        r#"
        SELECT
            id, repository_id, branch_pattern, require_pull_request, required_approvals,
            require_status_checks, allow_force_push, allow_admin_bypass, created_at, updated_at
        FROM branch_protection_rules
        WHERE repository_id = $1
        ORDER BY branch_pattern
        "#,
    )
    .bind(repo.id)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    Ok(Json(rules))
}

async fn create_branch_protection_rule(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_path, repo_slug)): Path<(String, String)>,
    Json(body): Json<CreateBranchProtectionRequest>,
) -> Result<(StatusCode, Json<BranchProtectionRule>), ApiError> {
    body.validate()
        .map_err(|e| ApiError::from(DomainError::Validation(e.to_string())))?;

    let (org, repo) = load_repo(&state.pool, &crate::org::org_path_from_param(&org_path), &repo_slug).await?;
    permissions::ensure_can_admin_repo(&state.pool, org.id, &repo, &auth).await?;

    let branch_pattern = body.branch_pattern.trim().to_string();
    if branch_pattern.is_empty() {
        return Err(DomainError::Validation("branch_pattern is required".into()).into());
    }

    let required_approvals = body.required_approvals.unwrap_or(1);
    if required_approvals < 0 {
        return Err(DomainError::Validation("required_approvals must be >= 0".into()).into());
    }

    let rule = sqlx::query_as::<_, BranchProtectionRule>(
        r#"
        INSERT INTO branch_protection_rules (
            repository_id, branch_pattern, require_pull_request, required_approvals,
            require_status_checks, allow_force_push, allow_admin_bypass
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING
            id, repository_id, branch_pattern, require_pull_request, required_approvals,
            require_status_checks, allow_force_push, allow_admin_bypass, created_at, updated_at
        "#,
    )
    .bind(repo.id)
    .bind(&branch_pattern)
    .bind(body.require_pull_request.unwrap_or(true))
    .bind(required_approvals)
    .bind(body.require_status_checks.unwrap_or(false))
    .bind(body.allow_force_push.unwrap_or(false))
    .bind(body.allow_admin_bypass.unwrap_or(true))
    .fetch_one(&state.pool)
    .await
    .map_err(|e| match e.as_database_error().and_then(|db| db.code()) {
        Some(code) if code.as_ref() == "23505" => {
            ApiError::from(DomainError::Conflict(
                "a rule for this branch pattern already exists".into(),
            ))
        }
        _ => ApiError::from(DomainError::Internal(e.to_string())),
    })?;

    Ok((StatusCode::CREATED, Json(rule)))
}

async fn update_branch_protection_rule(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_path, repo_slug, rule_id)): Path<(String, String, Uuid)>,
    Json(body): Json<UpdateBranchProtectionRequest>,
) -> Result<Json<BranchProtectionRule>, ApiError> {
    body.validate()
        .map_err(|e| ApiError::from(DomainError::Validation(e.to_string())))?;

    let (org, repo) = load_repo(&state.pool, &crate::org::org_path_from_param(&org_path), &repo_slug).await?;
    permissions::ensure_can_admin_repo(&state.pool, org.id, &repo, &auth).await?;

    let existing = fetch_rule(&state.pool, repo.id, rule_id).await?;

    if let Some(required_approvals) = body.required_approvals {
        if required_approvals < 0 {
            return Err(DomainError::Validation("required_approvals must be >= 0".into()).into());
        }
    }

    let branch_pattern = body
        .branch_pattern
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or(existing.branch_pattern);

    let rule = sqlx::query_as::<_, BranchProtectionRule>(
        r#"
        UPDATE branch_protection_rules
        SET
            branch_pattern = $3,
            require_pull_request = COALESCE($4, require_pull_request),
            required_approvals = COALESCE($5, required_approvals),
            require_status_checks = COALESCE($6, require_status_checks),
            allow_force_push = COALESCE($7, allow_force_push),
            allow_admin_bypass = COALESCE($8, allow_admin_bypass),
            updated_at = NOW()
        WHERE id = $1 AND repository_id = $2
        RETURNING
            id, repository_id, branch_pattern, require_pull_request, required_approvals,
            require_status_checks, allow_force_push, allow_admin_bypass, created_at, updated_at
        "#,
    )
    .bind(rule_id)
    .bind(repo.id)
    .bind(&branch_pattern)
    .bind(body.require_pull_request)
    .bind(body.required_approvals)
    .bind(body.require_status_checks)
    .bind(body.allow_force_push)
    .bind(body.allow_admin_bypass)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| match e.as_database_error().and_then(|db| db.code()) {
        Some(code) if code.as_ref() == "23505" => {
            ApiError::from(DomainError::Conflict(
                "a rule for this branch pattern already exists".into(),
            ))
        }
        _ => ApiError::from(DomainError::Internal(e.to_string())),
    })?
    .ok_or(DomainError::NotFound)?;

    Ok(Json(rule))
}

async fn delete_branch_protection_rule(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_path, repo_slug, rule_id)): Path<(String, String, Uuid)>,
) -> Result<StatusCode, ApiError> {
    let (org, repo) = load_repo(&state.pool, &crate::org::org_path_from_param(&org_path), &repo_slug).await?;
    permissions::ensure_can_admin_repo(&state.pool, org.id, &repo, &auth).await?;

    let deleted = sqlx::query(
        "DELETE FROM branch_protection_rules WHERE id = $1 AND repository_id = $2",
    )
    .bind(rule_id)
    .bind(repo.id)
    .execute(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    if deleted.rows_affected() == 0 {
        return Err(DomainError::NotFound.into());
    }

    Ok(StatusCode::NO_CONTENT)
}

pub async fn matching_rule_for_branch(
    pool: &PgPool,
    repository_id: Uuid,
    branch: &str,
) -> Result<Option<BranchProtectionRule>, DomainError> {
    let rules = sqlx::query_as::<_, BranchProtectionRule>(
        r#"
        SELECT
            id, repository_id, branch_pattern, require_pull_request, required_approvals,
            require_status_checks, allow_force_push, allow_admin_bypass, created_at, updated_at
        FROM branch_protection_rules
        WHERE repository_id = $1
        "#,
    )
    .bind(repository_id)
    .fetch_all(pool)
    .await
    .map_err(|e| DomainError::Internal(e.to_string()))?;

    Ok(rules
        .into_iter()
        .find(|rule| branch_matches_pattern(branch, &rule.branch_pattern)))
}

pub async fn user_can_bypass_protection(
    pool: &PgPool,
    org_id: Uuid,
    repository_id: Uuid,
    user_id: Uuid,
) -> Result<bool, DomainError> {
    if sqlx::query_scalar::<_, bool>(
        r#"
        SELECT EXISTS(
            SELECT 1 FROM repository_permissions
            WHERE repository_id = $1 AND user_id = $2 AND role = 'admin'
        )
        "#,
    )
    .bind(repository_id)
    .bind(user_id)
    .fetch_one(pool)
    .await
    .map_err(|e| DomainError::Internal(e.to_string()))?
    {
        return Ok(true);
    }

    let org_role = sqlx::query_scalar::<_, OrgRole>(
        r#"
        SELECT role FROM organization_members
        WHERE organization_id = $1 AND user_id = $2
        "#,
    )
    .bind(org_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| DomainError::Internal(e.to_string()))?;

    Ok(matches!(org_role, Some(OrgRole::Owner) | Some(OrgRole::Admin)))
}

pub async fn ensure_merge_allowed(
    pool: &PgPool,
    repository_id: Uuid,
    target_branch: &str,
    approved_count: i32,
    changes_requested_count: i32,
    head_sha: &str,
) -> Result<(), DomainError> {
    let Some(rule) = matching_rule_for_branch(pool, repository_id, target_branch).await? else {
        return Ok(());
    };

    if rule.required_approvals > 0 && approved_count < rule.required_approvals {
        return Err(DomainError::Validation(format!(
            "branch '{target_branch}' requires {} approving review(s); has {approved_count}",
            rule.required_approvals
        )));
    }

    if changes_requested_count > 0 {
        return Err(DomainError::Validation(format!(
            "branch '{target_branch}' has open change requests"
        )));
    }

    if rule.require_status_checks {
        ensure_required_status_checks(pool, repository_id, head_sha).await?;
    }

    Ok(())
}

async fn ensure_required_status_checks(
    pool: &PgPool,
    repository_id: Uuid,
    commit_sha: &str,
) -> Result<(), DomainError> {
    let rows = sqlx::query_as::<_, (String, String)>(
        r#"
        SELECT context, state::text
        FROM commit_statuses
        WHERE repository_id = $1 AND commit_sha = $2 AND required = TRUE
        "#,
    )
    .bind(repository_id)
    .bind(commit_sha)
    .fetch_all(pool)
    .await
    .map_err(|e| DomainError::Internal(e.to_string()))?;

    if rows.is_empty() {
        return Err(DomainError::Validation(
            "required CI status checks must pass before merge".into(),
        ));
    }

    let mut failed = Vec::new();
    let mut pending = Vec::new();
    for (context, state) in rows {
        match state.as_str() {
            "success" => {}
            "pending" => pending.push(context),
            _ => failed.push(context),
        }
    }

    if !failed.is_empty() {
        return Err(DomainError::Validation(format!(
            "CI checks failed: {}",
            failed.join(", ")
        )));
    }
    if !pending.is_empty() {
        return Err(DomainError::Validation(format!(
            "CI checks still running: {}",
            pending.join(", ")
        )));
    }

    Ok(())
}

pub async fn validate_push_updates(
    pool: &PgPool,
    repository_id: Uuid,
    user_id: Uuid,
    repo_path: &std::path::Path,
    updates: &[(String, String, String)],
) -> Result<(), String> {
    let org_id = sqlx::query_scalar::<_, Uuid>(
        "SELECT organization_id FROM repositories WHERE id = $1",
    )
    .bind(repository_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "repository not found".to_string())?;

    let can_bypass = user_can_bypass_protection(pool, org_id, repository_id, user_id)
        .await
        .map_err(|e| e.to_string())?;

    for (old_sha, new_sha, ref_name) in updates {
        let Some(branch) = ref_name.strip_prefix("refs/heads/") else {
            continue;
        };

        let Some(rule) = matching_rule_for_branch(pool, repository_id, branch)
            .await
            .map_err(|e| e.to_string())?
        else {
            continue;
        };

        if can_bypass && rule.allow_admin_bypass {
            continue;
        }

        let is_delete = new_sha.chars().all(|c| c == '0');
        if is_delete {
            return Err(format!("branch '{branch}' is protected and cannot be deleted"));
        }

        if rule.require_pull_request {
            return Err(format!(
                "branch '{branch}' is protected; open a pull request to merge changes"
            ));
        }

        if !rule.allow_force_push && !old_sha.chars().all(|c| c == '0') {
            let is_ancestor = pertisk_git::refs::is_ancestor(repo_path, old_sha, new_sha)
                .await
                .map_err(|e| e.to_string())?;
            if !is_ancestor {
                return Err(format!("branch '{branch}' is protected; force push is not allowed"));
            }
        }
    }

    Ok(())
}

async fn load_repo(
    pool: &PgPool,
    org_slug: &str,
    repo_slug: &str,
) -> Result<(Organization, Repository), ApiError> {
    let org = sqlx::query_as::<_, Organization>(
        "SELECT id, slug, name, description, parent_id, full_path, created_at, updated_at FROM organizations WHERE full_path = $1",
    )
    .bind(org_slug)
    .fetch_optional(pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?
    .ok_or(DomainError::NotFound)?;

    let repo = sqlx::query_as::<_, Repository>(
        r#"
        SELECT id, organization_id, name, slug, description, visibility, default_branch, created_at, updated_at
        FROM repositories
        WHERE organization_id = $1 AND slug = $2
        "#,
    )
    .bind(org.id)
    .bind(repo_slug)
    .fetch_optional(pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?
    .ok_or(DomainError::NotFound)?;

    Ok((org, repo))
}

async fn fetch_rule(
    pool: &PgPool,
    repository_id: Uuid,
    rule_id: Uuid,
) -> Result<BranchProtectionRule, ApiError> {
    sqlx::query_as::<_, BranchProtectionRule>(
        r#"
        SELECT
            id, repository_id, branch_pattern, require_pull_request, required_approvals,
            require_status_checks, allow_force_push, allow_admin_bypass, created_at, updated_at
        FROM branch_protection_rules
        WHERE id = $1 AND repository_id = $2
        "#,
    )
    .bind(rule_id)
    .bind(repository_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?
    .ok_or(DomainError::NotFound.into())
}
