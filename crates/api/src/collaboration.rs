use std::path::PathBuf;

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{get, patch, post},
    Json, Router,
};
use pertisk_domain::{
    models::*,
    DomainError,
};
use pertisk_git::explorer::{self, CompareResult};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;
use validator::Validate;

use crate::{
    ensure_can_read_repo, ensure_can_write_repo, load_repo_for_read, map_explorer_error, ApiError,
    AppState, AuthUser, OptionalAuth,
};

pub fn collaboration_read_routes() -> Router<AppState> {
    Router::new()
        .route(
            "/organizations/{org_path}/repositories/{repo_slug}/labels",
            get(list_labels),
        )
        .route(
            "/organizations/{org_path}/repositories/{repo_slug}/milestones",
            get(list_milestones),
        )
        .route(
            "/organizations/{org_path}/repositories/{repo_slug}/issues",
            get(list_issues),
        )
        .route(
            "/organizations/{org_path}/repositories/{repo_slug}/issues/{issue_number}",
            get(get_issue),
        )
        .route(
            "/organizations/{org_path}/repositories/{repo_slug}/issues/{issue_number}/comments",
            get(list_issue_comments),
        )
        .route(
            "/organizations/{org_path}/repositories/{repo_slug}/pulls",
            get(list_pull_requests),
        )
        .route(
            "/organizations/{org_path}/repositories/{repo_slug}/pulls/{pull_number}",
            get(get_pull_request),
        )
        .route(
            "/organizations/{org_path}/repositories/{repo_slug}/pulls/{pull_number}/compare",
            get(get_pull_request_compare),
        )
        .route(
            "/organizations/{org_path}/repositories/{repo_slug}/pulls/{pull_number}/comments",
            get(list_pull_request_comments),
        )
        .route(
            "/organizations/{org_path}/repositories/{repo_slug}/pulls/{pull_number}/reviews",
            get(list_pull_request_reviews),
        )
}

pub fn collaboration_write_routes() -> Router<AppState> {
    Router::new()
        .route(
            "/organizations/{org_path}/repositories/{repo_slug}/labels",
            post(create_label),
        )
        .route(
            "/organizations/{org_path}/repositories/{repo_slug}/milestones",
            post(create_milestone),
        )
        .route(
            "/organizations/{org_path}/repositories/{repo_slug}/issues",
            post(create_issue),
        )
        .route(
            "/organizations/{org_path}/repositories/{repo_slug}/issues/{issue_number}",
            patch(update_issue),
        )
        .route(
            "/organizations/{org_path}/repositories/{repo_slug}/issues/{issue_number}/comments",
            post(create_issue_comment),
        )
        .route(
            "/organizations/{org_path}/repositories/{repo_slug}/pulls",
            post(create_pull_request),
        )
        .route(
            "/organizations/{org_path}/repositories/{repo_slug}/pulls/{pull_number}",
            patch(update_pull_request),
        )
        .route(
            "/organizations/{org_path}/repositories/{repo_slug}/pulls/{pull_number}/merge",
            post(merge_pull_request),
        )
        .route(
            "/organizations/{org_path}/repositories/{repo_slug}/pulls/{pull_number}/comments",
            post(create_pull_request_comment),
        )
        .route(
            "/organizations/{org_path}/repositories/{repo_slug}/pulls/{pull_number}/reviews",
            post(create_pull_request_review),
        )
}

#[derive(Serialize)]
struct IssueDetailResponse {
    issue: Issue,
    author: UserPublic,
    assignee: Option<UserPublic>,
    milestone: Option<Milestone>,
    labels: Vec<Label>,
}

#[derive(Serialize)]
struct IssueListResponse {
    issues: Vec<IssueDetailResponse>,
    open_count: i64,
    closed_count: i64,
}

#[derive(Serialize)]
struct PullRequestDetailResponse {
    pull_request: PullRequest,
    author: UserPublic,
    compare: Option<CompareResult>,
    review_summary: PullRequestReviewSummary,
}

#[derive(Serialize)]
struct PullRequestListResponse {
    pull_requests: Vec<PullRequestDetailResponse>,
    open_count: i64,
    closed_count: i64,
}

#[derive(Serialize)]
struct IssueCommentResponse {
    comment: IssueComment,
    author: UserPublic,
}

#[derive(Serialize)]
struct PullRequestCommentResponse {
    comment: PullRequestComment,
    author: UserPublic,
}

#[derive(Serialize)]
struct PullRequestReviewResponse {
    review: PullRequestReview,
    reviewer: UserPublic,
}

#[derive(Serialize)]
struct MergePullRequestResponse {
    merge_commit_sha: String,
    pull_request: PullRequest,
}

#[derive(Deserialize)]
struct IssueListQuery {
    state: Option<String>,
    label: Option<String>,
    milestone_id: Option<Uuid>,
    q: Option<String>,
}

#[derive(Deserialize)]
struct PullRequestListQuery {
    state: Option<String>,
}

async fn load_repo_db(
    state: &AppState,
    org_slug: &str,
    repo_slug: &str,
    user: Option<&AuthUser>,
) -> Result<(Repository, PathBuf), ApiError> {
    let (_org, repo, repo_path) =
        load_repo_for_read(state, org_slug, repo_slug, user).await?;
    Ok((repo, repo_path))
}

async fn next_issue_number(pool: &PgPool, repo_id: Uuid) -> Result<i32, ApiError> {
    sqlx::query(
        r#"
        INSERT INTO repository_counters (repository_id)
        VALUES ($1)
        ON CONFLICT (repository_id) DO NOTHING
        "#,
    )
    .bind(repo_id)
    .execute(pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    let number = sqlx::query_scalar::<_, i32>(
        r#"
        UPDATE repository_counters
        SET next_issue_number = next_issue_number + 1
        WHERE repository_id = $1
        RETURNING next_issue_number - 1
        "#,
    )
    .bind(repo_id)
    .fetch_one(pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    Ok(number)
}

async fn next_pull_number(pool: &PgPool, repo_id: Uuid) -> Result<i32, ApiError> {
    sqlx::query(
        r#"
        INSERT INTO repository_counters (repository_id)
        VALUES ($1)
        ON CONFLICT (repository_id) DO NOTHING
        "#,
    )
    .bind(repo_id)
    .execute(pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    let number = sqlx::query_scalar::<_, i32>(
        r#"
        UPDATE repository_counters
        SET next_pull_number = next_pull_number + 1
        WHERE repository_id = $1
        RETURNING next_pull_number - 1
        "#,
    )
    .bind(repo_id)
    .fetch_one(pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    Ok(number)
}

async fn fetch_user_public(pool: &PgPool, user_id: Uuid) -> Result<UserPublic, ApiError> {
    sqlx::query_as::<_, UserPublic>(
        r#"
        SELECT id, username, email, display_name, created_at
        FROM users WHERE id = $1
        "#,
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?
    .ok_or(DomainError::NotFound.into())
}

async fn fetch_issue_labels(pool: &PgPool, issue_id: Uuid) -> Result<Vec<Label>, ApiError> {
    sqlx::query_as::<_, Label>(
        r#"
        SELECT l.id, l.repository_id, l.name, l.color, l.description, l.created_at
        FROM labels l
        INNER JOIN issue_labels il ON il.label_id = l.id
        WHERE il.issue_id = $1
        ORDER BY l.name
        "#,
    )
    .bind(issue_id)
    .fetch_all(pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))
}

async fn build_issue_detail(pool: &PgPool, issue: Issue) -> Result<IssueDetailResponse, ApiError> {
    let author = fetch_user_public(pool, issue.author_id).await?;
    let assignee = match issue.assignee_id {
        Some(id) => Some(fetch_user_public(pool, id).await?),
        None => None,
    };
    let milestone = match issue.milestone_id {
        Some(id) => sqlx::query_as::<_, Milestone>(
            r#"
            SELECT id, repository_id, title, description, due_on, state, created_at, updated_at
            FROM milestones WHERE id = $1
            "#,
        )
        .bind(id)
        .fetch_optional(pool)
        .await
        .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?,
        None => None,
    };
    let labels = fetch_issue_labels(pool, issue.id).await?;

    Ok(IssueDetailResponse {
        issue,
        author,
        assignee,
        milestone,
        labels,
    })
}

async fn get_issue_by_number(
    pool: &PgPool,
    repo_id: Uuid,
    number: i32,
) -> Result<Issue, ApiError> {
    sqlx::query_as::<_, Issue>(
        r#"
        SELECT id, repository_id, number, author_id, assignee_id, milestone_id,
               title, body, state, created_at, updated_at, closed_at
        FROM issues
        WHERE repository_id = $1 AND number = $2
        "#,
    )
    .bind(repo_id)
    .bind(number)
    .fetch_optional(pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?
    .ok_or(DomainError::NotFound.into())
}

async fn get_pull_by_number(
    pool: &PgPool,
    repo_id: Uuid,
    number: i32,
) -> Result<PullRequest, ApiError> {
    sqlx::query_as::<_, PullRequest>(
        r#"
        SELECT id, repository_id, number, author_id, title, body, source_branch, target_branch,
               state, merge_commit_sha, created_at, updated_at, merged_at, closed_at
        FROM pull_requests
        WHERE repository_id = $1 AND number = $2
        "#,
    )
    .bind(repo_id)
    .bind(number)
    .fetch_optional(pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?
    .ok_or(DomainError::NotFound.into())
}

async fn list_labels(
    State(state): State<AppState>,
    OptionalAuth(auth): OptionalAuth,
    Path((org_path, repo_slug)): Path<(String, String)>,
) -> Result<Json<Vec<Label>>, ApiError> {
    let (repo, _) = load_repo_db(&state, &crate::org::org_path_from_param(&org_path), &repo_slug, auth.as_ref()).await?;

    let labels = sqlx::query_as::<_, Label>(
        r#"
        SELECT id, repository_id, name, color, description, created_at
        FROM labels WHERE repository_id = $1 ORDER BY name
        "#,
    )
    .bind(repo.id)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    Ok(Json(labels))
}

async fn create_label(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_path, repo_slug)): Path<(String, String)>,
    Json(body): Json<CreateLabelRequest>,
) -> Result<(StatusCode, Json<Label>), ApiError> {
    body.validate()
        .map_err(|e| ApiError::from(DomainError::Validation(e.to_string())))?;

    let (repo, _) = load_repo_db(&state, &crate::org::org_path_from_param(&org_path), &repo_slug, Some(&auth)).await?;
    ensure_can_write_repo(&state, &crate::org::org_path_from_param(&org_path), &repo, &auth).await?;

    let color = body.color.unwrap_or_else(|| "#6366f1".into());

    let label = sqlx::query_as::<_, Label>(
        r#"
        INSERT INTO labels (repository_id, name, color, description)
        VALUES ($1, $2, $3, $4)
        RETURNING id, repository_id, name, color, description, created_at
        "#,
    )
    .bind(repo.id)
    .bind(&body.name)
    .bind(&color)
    .bind(&body.description)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    Ok((StatusCode::CREATED, Json(label)))
}

async fn list_milestones(
    State(state): State<AppState>,
    OptionalAuth(auth): OptionalAuth,
    Path((org_path, repo_slug)): Path<(String, String)>,
) -> Result<Json<Vec<Milestone>>, ApiError> {
    let (repo, _) = load_repo_db(&state, &crate::org::org_path_from_param(&org_path), &repo_slug, auth.as_ref()).await?;

    let milestones = sqlx::query_as::<_, Milestone>(
        r#"
        SELECT id, repository_id, title, description, due_on, state, created_at, updated_at
        FROM milestones WHERE repository_id = $1 ORDER BY created_at DESC
        "#,
    )
    .bind(repo.id)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    Ok(Json(milestones))
}

async fn create_milestone(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_path, repo_slug)): Path<(String, String)>,
    Json(body): Json<CreateMilestoneRequest>,
) -> Result<(StatusCode, Json<Milestone>), ApiError> {
    body.validate()
        .map_err(|e| ApiError::from(DomainError::Validation(e.to_string())))?;

    let (repo, _) = load_repo_db(&state, &crate::org::org_path_from_param(&org_path), &repo_slug, Some(&auth)).await?;
    ensure_can_write_repo(&state, &crate::org::org_path_from_param(&org_path), &repo, &auth).await?;

    let milestone = sqlx::query_as::<_, Milestone>(
        r#"
        INSERT INTO milestones (repository_id, title, description, due_on)
        VALUES ($1, $2, $3, $4)
        RETURNING id, repository_id, title, description, due_on, state, created_at, updated_at
        "#,
    )
    .bind(repo.id)
    .bind(&body.title)
    .bind(&body.description)
    .bind(body.due_on)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    Ok((StatusCode::CREATED, Json(milestone)))
}

async fn list_issues(
    State(state): State<AppState>,
    OptionalAuth(auth): OptionalAuth,
    Path((org_path, repo_slug)): Path<(String, String)>,
    Query(query): Query<IssueListQuery>,
) -> Result<Json<IssueListResponse>, ApiError> {
    let (repo, _) = load_repo_db(&state, &crate::org::org_path_from_param(&org_path), &repo_slug, auth.as_ref()).await?;

    let state_filter = query.state.as_deref().unwrap_or("open");
    let search = query.q.as_deref().unwrap_or("").trim();

    let issues = if search.is_empty() {
        sqlx::query_as::<_, Issue>(
            r#"
            SELECT i.id, i.repository_id, i.number, i.author_id, i.assignee_id, i.milestone_id,
                   i.title, i.body, i.state, i.created_at, i.updated_at, i.closed_at
            FROM issues i
            LEFT JOIN issue_labels il ON il.issue_id = i.id
            LEFT JOIN labels l ON l.id = il.label_id
            WHERE i.repository_id = $1
              AND ($2 = 'all' OR i.state::text = $2)
              AND ($3::uuid IS NULL OR i.milestone_id = $3)
              AND ($4::text IS NULL OR l.name = $4)
            GROUP BY i.id
            ORDER BY i.updated_at DESC
            "#,
        )
        .bind(repo.id)
        .bind(state_filter)
        .bind(query.milestone_id)
        .bind(query.label.as_deref())
        .fetch_all(&state.pool)
        .await
    } else {
        let pattern = format!("%{search}%");
        sqlx::query_as::<_, Issue>(
            r#"
            SELECT i.id, i.repository_id, i.number, i.author_id, i.assignee_id, i.milestone_id,
                   i.title, i.body, i.state, i.created_at, i.updated_at, i.closed_at
            FROM issues i
            LEFT JOIN issue_labels il ON il.issue_id = i.id
            LEFT JOIN labels l ON l.id = il.label_id
            WHERE i.repository_id = $1
              AND ($2 = 'all' OR i.state::text = $2)
              AND ($3::uuid IS NULL OR i.milestone_id = $3)
              AND ($4::text IS NULL OR l.name = $4)
              AND (i.title ILIKE $5 OR i.body ILIKE $5)
            GROUP BY i.id
            ORDER BY i.updated_at DESC
            "#,
        )
        .bind(repo.id)
        .bind(state_filter)
        .bind(query.milestone_id)
        .bind(query.label.as_deref())
        .bind(pattern)
        .fetch_all(&state.pool)
        .await
    }
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    let mut items = Vec::with_capacity(issues.len());
    for issue in issues {
        items.push(build_issue_detail(&state.pool, issue).await?);
    }

    let open_count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM issues WHERE repository_id = $1 AND state = 'open'",
    )
    .bind(repo.id)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    let closed_count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM issues WHERE repository_id = $1 AND state = 'closed'",
    )
    .bind(repo.id)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    Ok(Json(IssueListResponse {
        issues: items,
        open_count,
        closed_count,
    }))
}

async fn get_issue(
    State(state): State<AppState>,
    OptionalAuth(auth): OptionalAuth,
    Path((org_path, repo_slug, issue_number)): Path<(String, String, i32)>,
) -> Result<Json<IssueDetailResponse>, ApiError> {
    let (repo, _) = load_repo_db(&state, &crate::org::org_path_from_param(&org_path), &repo_slug, auth.as_ref()).await?;
    let issue = get_issue_by_number(&state.pool, repo.id, issue_number).await?;
    Ok(Json(build_issue_detail(&state.pool, issue).await?))
}

async fn create_issue(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_path, repo_slug)): Path<(String, String)>,
    Json(body): Json<CreateIssueRequest>,
) -> Result<(StatusCode, Json<IssueDetailResponse>), ApiError> {
    body.validate()
        .map_err(|e| ApiError::from(DomainError::Validation(e.to_string())))?;

    let (repo, _) = load_repo_db(&state, &crate::org::org_path_from_param(&org_path), &repo_slug, Some(&auth)).await?;
    ensure_can_write_repo(&state, &crate::org::org_path_from_param(&org_path), &repo, &auth).await?;

    let number = next_issue_number(&state.pool, repo.id).await?;
    let body_text = body.body.unwrap_or_default();

    let issue = sqlx::query_as::<_, Issue>(
        r#"
        INSERT INTO issues (repository_id, number, author_id, assignee_id, milestone_id, title, body)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id, repository_id, number, author_id, assignee_id, milestone_id,
                  title, body, state, created_at, updated_at, closed_at
        "#,
    )
    .bind(repo.id)
    .bind(number)
    .bind(auth.user_id)
    .bind(body.assignee_id)
    .bind(body.milestone_id)
    .bind(&body.title)
    .bind(&body_text)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    if let Some(label_ids) = body.label_ids {
        for label_id in label_ids {
            sqlx::query(
                r#"
                INSERT INTO issue_labels (issue_id, label_id)
                SELECT $1, $2 FROM labels WHERE id = $2 AND repository_id = $3
                "#,
            )
            .bind(issue.id)
            .bind(label_id)
            .bind(repo.id)
            .execute(&state.pool)
            .await
            .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;
        }
    }

    Ok((
        StatusCode::CREATED,
        Json(build_issue_detail(&state.pool, issue).await?),
    ))
}

async fn update_issue(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_path, repo_slug, issue_number)): Path<(String, String, i32)>,
    Json(body): Json<UpdateIssueRequest>,
) -> Result<Json<IssueDetailResponse>, ApiError> {
    body.validate()
        .map_err(|e| ApiError::from(DomainError::Validation(e.to_string())))?;

    let (repo, _) = load_repo_db(&state, &crate::org::org_path_from_param(&org_path), &repo_slug, Some(&auth)).await?;
    ensure_can_write_repo(&state, &crate::org::org_path_from_param(&org_path), &repo, &auth).await?;

    let existing = get_issue_by_number(&state.pool, repo.id, issue_number).await?;

    let title = body.title.unwrap_or(existing.title);
    let issue_body = body.body.unwrap_or(existing.body);
    let state_val = body.state.unwrap_or(existing.state);
    let assignee_id = match body.assignee_id {
        Some(v) => v,
        None => existing.assignee_id,
    };
    let milestone_id = match body.milestone_id {
        Some(v) => v,
        None => existing.milestone_id,
    };
    let closed_at: Option<chrono::DateTime<chrono::Utc>> = match state_val {
        IssueState::Closed if existing.state == IssueState::Open => Some(chrono::Utc::now()),
        IssueState::Open => None,
        _ => existing.closed_at,
    };

    let issue = sqlx::query_as::<_, Issue>(
        r#"
        UPDATE issues
        SET title = $1, body = $2, state = $3, assignee_id = $4, milestone_id = $5,
            closed_at = $6, updated_at = NOW()
        WHERE id = $7
        RETURNING id, repository_id, number, author_id, assignee_id, milestone_id,
                  title, body, state, created_at, updated_at, closed_at
        "#,
    )
    .bind(title)
    .bind(issue_body)
    .bind(state_val)
    .bind(assignee_id)
    .bind(milestone_id)
    .bind(closed_at)
    .bind(existing.id)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    if let Some(label_ids) = body.label_ids {
        sqlx::query("DELETE FROM issue_labels WHERE issue_id = $1")
            .bind(issue.id)
            .execute(&state.pool)
            .await
            .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

        for label_id in label_ids {
            sqlx::query(
                r#"
                INSERT INTO issue_labels (issue_id, label_id)
                SELECT $1, $2 FROM labels WHERE id = $2 AND repository_id = $3
                "#,
            )
            .bind(issue.id)
            .bind(label_id)
            .bind(repo.id)
            .execute(&state.pool)
            .await
            .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;
        }
    }

    Ok(Json(build_issue_detail(&state.pool, issue).await?))
}

async fn list_issue_comments(
    State(state): State<AppState>,
    OptionalAuth(auth): OptionalAuth,
    Path((org_path, repo_slug, issue_number)): Path<(String, String, i32)>,
) -> Result<Json<Vec<IssueCommentResponse>>, ApiError> {
    let (repo, _) = load_repo_db(&state, &crate::org::org_path_from_param(&org_path), &repo_slug, auth.as_ref()).await?;
    let issue = get_issue_by_number(&state.pool, repo.id, issue_number).await?;

    let comments = sqlx::query_as::<_, IssueComment>(
        r#"
        SELECT id, issue_id, author_id, body, created_at, updated_at
        FROM issue_comments WHERE issue_id = $1 ORDER BY created_at ASC
        "#,
    )
    .bind(issue.id)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    let mut items = Vec::with_capacity(comments.len());
    for comment in comments {
        items.push(IssueCommentResponse {
            author: fetch_user_public(&state.pool, comment.author_id).await?,
            comment,
        });
    }

    Ok(Json(items))
}

async fn create_issue_comment(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_path, repo_slug, issue_number)): Path<(String, String, i32)>,
    Json(body): Json<CreateIssueCommentRequest>,
) -> Result<(StatusCode, Json<IssueCommentResponse>), ApiError> {
    body.validate()
        .map_err(|e| ApiError::from(DomainError::Validation(e.to_string())))?;

    let (repo, _) = load_repo_db(&state, &crate::org::org_path_from_param(&org_path), &repo_slug, Some(&auth)).await?;
    ensure_can_write_repo(&state, &crate::org::org_path_from_param(&org_path), &repo, &auth).await?;
    let issue = get_issue_by_number(&state.pool, repo.id, issue_number).await?;

    let comment = sqlx::query_as::<_, IssueComment>(
        r#"
        INSERT INTO issue_comments (issue_id, author_id, body)
        VALUES ($1, $2, $3)
        RETURNING id, issue_id, author_id, body, created_at, updated_at
        "#,
    )
    .bind(issue.id)
    .bind(auth.user_id)
    .bind(&body.body)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    sqlx::query("UPDATE issues SET updated_at = NOW() WHERE id = $1")
        .bind(issue.id)
        .execute(&state.pool)
        .await
        .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    Ok((
        StatusCode::CREATED,
        Json(IssueCommentResponse {
            author: fetch_user_public(&state.pool, auth.user_id).await?,
            comment,
        }),
    ))
}

async fn build_pull_detail(
    pool: &PgPool,
    repo_path: &PathBuf,
    pull: PullRequest,
    include_compare: bool,
) -> Result<PullRequestDetailResponse, ApiError> {
    let author = fetch_user_public(pool, pull.author_id).await?;
    let review_summary = fetch_review_summary(pool, pull.id).await?;
    let compare = if include_compare && pull.state == PullRequestState::Open {
        explorer::compare_branches(repo_path, &pull.target_branch, &pull.source_branch)
            .await
            .ok()
    } else {
        None
    };

    Ok(PullRequestDetailResponse {
        pull_request: pull,
        author,
        compare,
        review_summary,
    })
}

async fn fetch_review_summary(
    pool: &PgPool,
    pull_id: Uuid,
) -> Result<PullRequestReviewSummary, ApiError> {
    let reviews = sqlx::query_as::<_, PullRequestReview>(
        r#"
        SELECT id, pull_request_id, reviewer_id, state, body, commit_sha, created_at
        FROM pr_reviews
        WHERE pull_request_id = $1
        ORDER BY created_at DESC
        "#,
    )
    .bind(pull_id)
    .fetch_all(pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    let mut latest_by_reviewer: std::collections::HashMap<Uuid, ReviewState> =
        std::collections::HashMap::new();
    for review in reviews {
        latest_by_reviewer
            .entry(review.reviewer_id)
            .or_insert(review.state);
    }

    let mut approved_count = 0i32;
    let mut changes_requested_count = 0i32;
    let mut approved_reviewer_ids = Vec::new();

    for (reviewer_id, state) in latest_by_reviewer {
        match state {
            ReviewState::Approved => {
                approved_count += 1;
                approved_reviewer_ids.push(reviewer_id);
            }
            ReviewState::ChangesRequested => changes_requested_count += 1,
            _ => {}
        }
    }

    approved_reviewer_ids.sort();
    let mut approved_by = Vec::with_capacity(approved_reviewer_ids.len());
    for reviewer_id in approved_reviewer_ids {
        approved_by.push(fetch_user_public(pool, reviewer_id).await?);
    }

    Ok(PullRequestReviewSummary {
        approved_count,
        changes_requested_count,
        approved_by,
    })
}

async fn list_pull_requests(
    State(state): State<AppState>,
    OptionalAuth(auth): OptionalAuth,
    Path((org_path, repo_slug)): Path<(String, String)>,
    Query(query): Query<PullRequestListQuery>,
) -> Result<Json<PullRequestListResponse>, ApiError> {
    let (repo, repo_path) = load_repo_db(&state, &crate::org::org_path_from_param(&org_path), &repo_slug, auth.as_ref()).await?;
    let state_filter = query.state.as_deref().unwrap_or("open");

    let pulls = sqlx::query_as::<_, PullRequest>(
        r#"
        SELECT id, repository_id, number, author_id, title, body, source_branch, target_branch,
               state, merge_commit_sha, created_at, updated_at, merged_at, closed_at
        FROM pull_requests
        WHERE repository_id = $1 AND ($2 = 'all' OR state::text = $2)
        ORDER BY updated_at DESC
        "#,
    )
    .bind(repo.id)
    .bind(state_filter)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    let mut items = Vec::with_capacity(pulls.len());
    for pull in pulls {
        items.push(build_pull_detail(&state.pool, &repo_path, pull, false).await?);
    }

    let open_count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM pull_requests WHERE repository_id = $1 AND state = 'open'",
    )
    .bind(repo.id)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    let closed_count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM pull_requests WHERE repository_id = $1 AND state != 'open'",
    )
    .bind(repo.id)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    Ok(Json(PullRequestListResponse {
        pull_requests: items,
        open_count,
        closed_count,
    }))
}

async fn get_pull_request(
    State(state): State<AppState>,
    OptionalAuth(auth): OptionalAuth,
    Path((org_path, repo_slug, pull_number)): Path<(String, String, i32)>,
) -> Result<Json<PullRequestDetailResponse>, ApiError> {
    let (repo, repo_path) = load_repo_db(&state, &crate::org::org_path_from_param(&org_path), &repo_slug, auth.as_ref()).await?;
    let pull = get_pull_by_number(&state.pool, repo.id, pull_number).await?;
    Ok(Json(
        build_pull_detail(&state.pool, &repo_path, pull, true).await?,
    ))
}

async fn get_pull_request_compare(
    State(state): State<AppState>,
    OptionalAuth(auth): OptionalAuth,
    Path((org_path, repo_slug, pull_number)): Path<(String, String, i32)>,
) -> Result<Json<CompareResult>, ApiError> {
    let (repo, repo_path) = load_repo_db(&state, &crate::org::org_path_from_param(&org_path), &repo_slug, auth.as_ref()).await?;
    let pull = get_pull_by_number(&state.pool, repo.id, pull_number).await?;

    let compare = explorer::compare_branches(&repo_path, &pull.target_branch, &pull.source_branch)
        .await
        .map_err(map_explorer_error)?;

    Ok(Json(compare))
}

async fn create_pull_request(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_path, repo_slug)): Path<(String, String)>,
    Json(body): Json<CreatePullRequestRequest>,
) -> Result<(StatusCode, Json<PullRequestDetailResponse>), ApiError> {
    body.validate()
        .map_err(|e| ApiError::from(DomainError::Validation(e.to_string())))?;

    if body.source_branch == body.target_branch {
        return Err(DomainError::Validation("source and target branches must differ".into()).into());
    }

    let (repo, repo_path) = load_repo_db(&state, &crate::org::org_path_from_param(&org_path), &repo_slug, Some(&auth)).await?;
    ensure_can_write_repo(&state, &crate::org::org_path_from_param(&org_path), &repo, &auth).await?;

    let compare = explorer::compare_branches(&repo_path, &body.target_branch, &body.source_branch)
        .await
        .map_err(map_explorer_error)?;

    let number = next_pull_number(&state.pool, repo.id).await?;
    let body_text = body.body.unwrap_or_default();

    let pull = sqlx::query_as::<_, PullRequest>(
        r#"
        INSERT INTO pull_requests (repository_id, number, author_id, title, body, source_branch, target_branch)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id, repository_id, number, author_id, title, body, source_branch, target_branch,
                  state, merge_commit_sha, created_at, updated_at, merged_at, closed_at
        "#,
    )
    .bind(repo.id)
    .bind(number)
    .bind(auth.user_id)
    .bind(&body.title)
    .bind(&body_text)
    .bind(&body.source_branch)
    .bind(&body.target_branch)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    if let Some(head) = compare.commits.last() {
        if let Err(err) = crate::cicd::enqueue_pull_request_triggers_for_branch(
            &state.pool,
            repo.id,
            &pull.source_branch,
            &head.sha,
        )
        .await
        {
            tracing::warn!("failed to enqueue PR pipeline triggers: {err:#}");
        }
    }

    Ok((
        StatusCode::CREATED,
        Json(build_pull_detail(&state.pool, &repo_path, pull, true).await?),
    ))
}

async fn update_pull_request(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_path, repo_slug, pull_number)): Path<(String, String, i32)>,
    Json(body): Json<UpdatePullRequestRequest>,
) -> Result<Json<PullRequestDetailResponse>, ApiError> {
    body.validate()
        .map_err(|e| ApiError::from(DomainError::Validation(e.to_string())))?;

    let (repo, repo_path) = load_repo_db(&state, &crate::org::org_path_from_param(&org_path), &repo_slug, Some(&auth)).await?;
    ensure_can_write_repo(&state, &crate::org::org_path_from_param(&org_path), &repo, &auth).await?;
    let existing = get_pull_by_number(&state.pool, repo.id, pull_number).await?;

    let title = body.title.unwrap_or(existing.title);
    let pr_body = body.body.unwrap_or(existing.body);
    let state_val = body.state.unwrap_or(existing.state);

    let (merged_at, closed_at) = match state_val {
        PullRequestState::Merged if existing.state != PullRequestState::Merged => {
            (Some(chrono::Utc::now()), existing.closed_at)
        }
        PullRequestState::Closed if existing.state == PullRequestState::Open => {
            (existing.merged_at, Some(chrono::Utc::now()))
        }
        PullRequestState::Open => (None, None),
        _ => (existing.merged_at, existing.closed_at),
    };

    let pull = sqlx::query_as::<_, PullRequest>(
        r#"
        UPDATE pull_requests
        SET title = $1, body = $2, state = $3, merged_at = $4, closed_at = $5, updated_at = NOW()
        WHERE id = $6
        RETURNING id, repository_id, number, author_id, title, body, source_branch, target_branch,
                  state, merge_commit_sha, created_at, updated_at, merged_at, closed_at
        "#,
    )
    .bind(title)
    .bind(pr_body)
    .bind(state_val)
    .bind(merged_at)
    .bind(closed_at)
    .bind(existing.id)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    Ok(Json(
        build_pull_detail(&state.pool, &repo_path, pull, true).await?,
    ))
}

async fn merge_pull_request(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_path, repo_slug, pull_number)): Path<(String, String, i32)>,
    Json(body): Json<MergePullRequestRequest>,
) -> Result<Json<MergePullRequestResponse>, ApiError> {
    let (repo, repo_path) = load_repo_db(&state, &crate::org::org_path_from_param(&org_path), &repo_slug, Some(&auth)).await?;
    ensure_can_write_repo(&state, &crate::org::org_path_from_param(&org_path), &repo, &auth).await?;
    let existing = get_pull_by_number(&state.pool, repo.id, pull_number).await?;

    if existing.state != PullRequestState::Open {
        return Err(DomainError::Validation("pull request is not open".into()).into());
    }

    let compare = explorer::compare_branches(&repo_path, &existing.target_branch, &existing.source_branch)
        .await
        .map_err(map_explorer_error)?;

    let review_summary = fetch_review_summary(&state.pool, existing.id).await?;

    if let Some(head) = compare.commits.last() {
        let protection_rule = crate::branch_protection::matching_rule_for_branch(
            &state.pool,
            repo.id,
            &existing.target_branch,
        )
        .await?;

        if protection_rule.is_some() {
            crate::branch_protection::ensure_merge_allowed(
                &state.pool,
                repo.id,
                &existing.target_branch,
                review_summary.approved_count,
                review_summary.changes_requested_count,
                &head.sha,
            )
            .await?;
        }

        if !protection_rule
            .as_ref()
            .is_some_and(|rule| rule.require_status_checks)
        {
            crate::cicd::ensure_ci_passed_for_commit(&state.pool, repo.id, &head.sha).await?;
        }
    }

    let strategy = body.merge_strategy.as_deref().unwrap_or("merge");
    let message = match strategy {
        "squash" => format!(
            "Squash merge pull request #{} from {}",
            existing.number, existing.source_branch
        ),
        "rebase" => format!(
            "Rebase merge pull request #{} from {}",
            existing.number, existing.source_branch
        ),
        "merge" | "no-ff" => format!(
            "Merge pull request #{} from {} into {}",
            existing.number, existing.source_branch, existing.target_branch
        ),
        other => {
            return Err(DomainError::Validation(format!(
                "unsupported merge strategy '{other}' (use merge, squash, or rebase)"
            ))
            .into());
        }
    };

    let merge_sha = match strategy {
        "squash" => explorer::squash_branches(
            &repo_path,
            &existing.target_branch,
            &existing.source_branch,
            &message,
        )
        .await
        .map_err(map_explorer_error)?,
        "rebase" => explorer::rebase_branches(
            &repo_path,
            &existing.target_branch,
            &existing.source_branch,
        )
        .await
        .map_err(map_explorer_error)?,
        _ => explorer::merge_branches(
            &repo_path,
            &existing.target_branch,
            &existing.source_branch,
            &message,
        )
        .await
        .map_err(map_explorer_error)?,
    };

    let pull = sqlx::query_as::<_, PullRequest>(
        r#"
        UPDATE pull_requests
        SET state = 'merged', merge_commit_sha = $1, merged_at = NOW(), updated_at = NOW()
        WHERE id = $2
        RETURNING id, repository_id, number, author_id, title, body, source_branch, target_branch,
                  state, merge_commit_sha, created_at, updated_at, merged_at, closed_at
        "#,
    )
    .bind(&merge_sha)
    .bind(existing.id)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    let _ = crate::audit::record_audit_event(
        &state.pool,
        crate::audit::AuditEventInput {
            organization_id: Some(repo.organization_id),
            actor_user_id: Some(auth.user_id),
            event_type: pertisk_domain::models::AuditEventType::Merge,
            action: format!(
                "merged pull request #{} ({strategy})",
                existing.number
            ),
            resource_type: Some("pull_request".into()),
            resource_id: Some(existing.id.to_string()),
            metadata: Some(serde_json::json!({
                "pull_number": existing.number,
                "merge_strategy": strategy,
                "merge_commit_sha": merge_sha,
                "repo_slug": repo_slug,
            })),
            ip_address: None,
            user_agent: None,
        },
    )
    .await;

    Ok(Json(MergePullRequestResponse {
        merge_commit_sha: merge_sha,
        pull_request: pull,
    }))
}

async fn list_pull_request_comments(
    State(state): State<AppState>,
    OptionalAuth(auth): OptionalAuth,
    Path((org_path, repo_slug, pull_number)): Path<(String, String, i32)>,
) -> Result<Json<Vec<PullRequestCommentResponse>>, ApiError> {
    let (repo, _) = load_repo_db(&state, &crate::org::org_path_from_param(&org_path), &repo_slug, auth.as_ref()).await?;
    let pull = get_pull_by_number(&state.pool, repo.id, pull_number).await?;

    let comments = sqlx::query_as::<_, PullRequestComment>(
        r#"
        SELECT id, pull_request_id, author_id, body, path, line, created_at, updated_at
        FROM pr_comments WHERE pull_request_id = $1 ORDER BY created_at ASC
        "#,
    )
    .bind(pull.id)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    let mut items = Vec::with_capacity(comments.len());
    for comment in comments {
        items.push(PullRequestCommentResponse {
            author: fetch_user_public(&state.pool, comment.author_id).await?,
            comment,
        });
    }

    Ok(Json(items))
}

async fn create_pull_request_comment(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_path, repo_slug, pull_number)): Path<(String, String, i32)>,
    Json(body): Json<CreatePullRequestCommentRequest>,
) -> Result<(StatusCode, Json<PullRequestCommentResponse>), ApiError> {
    body.validate()
        .map_err(|e| ApiError::from(DomainError::Validation(e.to_string())))?;

    let (repo, _) = load_repo_db(&state, &crate::org::org_path_from_param(&org_path), &repo_slug, Some(&auth)).await?;
    ensure_can_read_repo(&state, &crate::org::org_path_from_param(&org_path), &repo, Some(&auth)).await?;
    let pull = get_pull_by_number(&state.pool, repo.id, pull_number).await?;

    let comment = sqlx::query_as::<_, PullRequestComment>(
        r#"
        INSERT INTO pr_comments (pull_request_id, author_id, body, path, line)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, pull_request_id, author_id, body, path, line, created_at, updated_at
        "#,
    )
    .bind(pull.id)
    .bind(auth.user_id)
    .bind(&body.body)
    .bind(&body.path)
    .bind(body.line)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    Ok((
        StatusCode::CREATED,
        Json(PullRequestCommentResponse {
            author: fetch_user_public(&state.pool, auth.user_id).await?,
            comment,
        }),
    ))
}

async fn list_pull_request_reviews(
    State(state): State<AppState>,
    OptionalAuth(auth): OptionalAuth,
    Path((org_path, repo_slug, pull_number)): Path<(String, String, i32)>,
) -> Result<Json<Vec<PullRequestReviewResponse>>, ApiError> {
    let (repo, _) = load_repo_db(&state, &crate::org::org_path_from_param(&org_path), &repo_slug, auth.as_ref()).await?;
    let pull = get_pull_by_number(&state.pool, repo.id, pull_number).await?;

    let reviews = sqlx::query_as::<_, PullRequestReview>(
        r#"
        SELECT id, pull_request_id, reviewer_id, state, body, commit_sha, created_at
        FROM pr_reviews WHERE pull_request_id = $1 ORDER BY created_at DESC
        "#,
    )
    .bind(pull.id)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    let mut items = Vec::with_capacity(reviews.len());
    for review in reviews {
        items.push(PullRequestReviewResponse {
            reviewer: fetch_user_public(&state.pool, review.reviewer_id).await?,
            review,
        });
    }

    Ok(Json(items))
}

async fn create_pull_request_review(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_path, repo_slug, pull_number)): Path<(String, String, i32)>,
    Json(body): Json<CreatePullRequestReviewRequest>,
) -> Result<(StatusCode, Json<PullRequestReviewResponse>), ApiError> {
    body.validate()
        .map_err(|e| ApiError::from(DomainError::Validation(e.to_string())))?;

    let (repo, _) = load_repo_db(&state, &crate::org::org_path_from_param(&org_path), &repo_slug, Some(&auth)).await?;
    ensure_can_read_repo(&state, &crate::org::org_path_from_param(&org_path), &repo, Some(&auth)).await?;
    let pull = get_pull_by_number(&state.pool, repo.id, pull_number).await?;

    let review = if let Some(existing) = sqlx::query_as::<_, PullRequestReview>(
        r#"
        SELECT id, pull_request_id, reviewer_id, state, body, commit_sha, created_at
        FROM pr_reviews
        WHERE pull_request_id = $1 AND reviewer_id = $2
        ORDER BY created_at DESC
        LIMIT 1
        "#,
    )
    .bind(pull.id)
    .bind(auth.user_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?
    {
        sqlx::query_as::<_, PullRequestReview>(
            r#"
            UPDATE pr_reviews
            SET state = $1, body = $2, created_at = NOW()
            WHERE id = $3
            RETURNING id, pull_request_id, reviewer_id, state, body, commit_sha, created_at
            "#,
        )
        .bind(body.state)
        .bind(&body.body)
        .bind(existing.id)
        .fetch_one(&state.pool)
        .await
        .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?
    } else {
        sqlx::query_as::<_, PullRequestReview>(
            r#"
            INSERT INTO pr_reviews (pull_request_id, reviewer_id, state, body)
            VALUES ($1, $2, $3, $4)
            RETURNING id, pull_request_id, reviewer_id, state, body, commit_sha, created_at
            "#,
        )
        .bind(pull.id)
        .bind(auth.user_id)
        .bind(body.state)
        .bind(&body.body)
        .fetch_one(&state.pool)
        .await
        .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?
    };

    Ok((
        StatusCode::CREATED,
        Json(PullRequestReviewResponse {
            reviewer: fetch_user_public(&state.pool, auth.user_id).await?,
            review,
        }),
    ))
}
