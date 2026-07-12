use axum::{
    extract::State,
    routing::{get, post},
    Json, Router,
};
use pertisk_git::explorer;
use pertisk_domain::models::{RepoVisibility, Repository};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{cicd, load_repo_for_read, repository_activity, ApiError, AppState, AuthUser};

const MAX_PROJECTS: usize = 50;

pub fn dashboard_routes() -> Router<AppState> {
    Router::new()
        .route("/dashboard/project-stats", post(project_stats))
        .route("/repositories/accessible", get(list_accessible_repositories))
}

#[derive(Debug, Deserialize)]
struct ProjectStatsRequest {
    projects: Vec<ProjectRef>,
}

#[derive(Debug, Deserialize)]
struct ProjectRef {
    org_path: String,
    slug: String,
}

#[derive(Serialize)]
struct ProjectStatsResponse {
    stats: Vec<ProjectStats>,
}

#[derive(Clone, Serialize)]
struct ProjectStats {
    org_path: String,
    slug: String,
    branch_count: u32,
    tag_count: u32,
    open_issue_count: i64,
    has_pipelines: bool,
    latest_pipeline_status: Option<String>,
}

#[derive(Debug, sqlx::FromRow)]
struct AccessibleRepositoryRow {
    id: Uuid,
    organization_id: Uuid,
    name: String,
    slug: String,
    description: Option<String>,
    visibility: RepoVisibility,
    default_branch: String,
    created_at: chrono::DateTime<chrono::Utc>,
    updated_at: chrono::DateTime<chrono::Utc>,
    last_commit_at: Option<chrono::DateTime<chrono::Utc>>,
    organization_path: String,
    organization_name: String,
}

#[derive(Serialize)]
struct AccessibleRepositoryListItem {
    #[serde(flatten)]
    repository: Repository,
    organization_path: String,
    organization_name: String,
}

async fn list_accessible_repositories(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<Vec<AccessibleRepositoryListItem>>, ApiError> {
    let mut repos = sqlx::query_as::<_, AccessibleRepositoryRow>(
        r#"
        SELECT
            r.id,
            r.organization_id,
            r.name,
            r.slug,
            r.description,
            r.visibility,
            r.default_branch,
            r.created_at,
            r.updated_at,
            r.last_commit_at,
            o.full_path AS organization_path,
            o.name AS organization_name
        FROM repositories r
        INNER JOIN organizations o ON o.id = r.organization_id
        WHERE r.visibility = 'public'
           OR EXISTS (
                SELECT 1
                FROM organization_members om
                WHERE om.organization_id = r.organization_id
                  AND om.user_id = $1
           )
           OR EXISTS (
                SELECT 1
                FROM repository_permissions rp
                WHERE rp.repository_id = r.id
                  AND rp.user_id = $1
           )
        ORDER BY COALESCE(r.last_commit_at, r.updated_at) DESC, o.full_path, r.name
        "#,
    )
    .bind(auth.user_id)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| ApiError::from(pertisk_domain::DomainError::Internal(e.to_string())))?;

    if repos.iter().any(|repo| repo.last_commit_at.is_none()) {
        let pool = state.pool.clone();
        let repos_root = state.config.repos_root.clone();
        for repo in repos.iter_mut().filter(|repo| repo.last_commit_at.is_none()) {
            let mut repository = Repository {
                id: repo.id,
                organization_id: repo.organization_id,
                name: repo.name.clone(),
                slug: repo.slug.clone(),
                description: repo.description.clone(),
                visibility: repo.visibility,
                default_branch: repo.default_branch.clone(),
                created_at: repo.created_at,
                updated_at: repo.updated_at,
                last_commit_at: repo.last_commit_at,
            };
            repository_activity::backfill_repository_last_commit_at(
                &pool,
                &repos_root,
                &repo.organization_path,
                &mut repository,
            )
            .await;
            repo.last_commit_at = repository.last_commit_at;
        }
    }

    Ok(Json(
        repos
            .into_iter()
            .map(|row| AccessibleRepositoryListItem {
                repository: Repository {
                    id: row.id,
                    organization_id: row.organization_id,
                    name: row.name,
                    slug: row.slug,
                    description: row.description,
                    visibility: row.visibility,
                    default_branch: row.default_branch,
                    created_at: row.created_at,
                    updated_at: row.updated_at,
                    last_commit_at: row.last_commit_at,
                },
                organization_path: row.organization_path,
                organization_name: row.organization_name,
            })
            .collect(),
    ))
}

async fn project_stats(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(body): Json<ProjectStatsRequest>,
) -> Result<Json<ProjectStatsResponse>, ApiError> {
    if body.projects.is_empty() {
        return Ok(Json(ProjectStatsResponse { stats: vec![] }));
    }
    if body.projects.len() > MAX_PROJECTS {
        return Err(crate::ApiError::from(pertisk_domain::DomainError::Validation(format!(
            "at most {MAX_PROJECTS} projects per request"
        ))));
    }

    let mut stats = Vec::with_capacity(body.projects.len());
    for project in body.projects {
        let org_path = crate::org::org_path_from_param(&project.org_path);
        let slug = project.slug.trim();
        if slug.is_empty() {
            continue;
        }

        let result = project_stat(&state, &auth, &org_path, slug).await;
        stats.push(match result {
            Ok(stat) => stat,
            Err(_) => ProjectStats {
                org_path,
                slug: slug.to_string(),
                branch_count: 0,
                tag_count: 0,
                open_issue_count: 0,
                has_pipelines: false,
                latest_pipeline_status: None,
            },
        });
    }

    Ok(Json(ProjectStatsResponse { stats }))
}

async fn project_stat(
    state: &AppState,
    auth: &AuthUser,
    org_path: &str,
    slug: &str,
) -> Result<ProjectStats, ApiError> {
    let (_org, repo, repo_path) =
        load_repo_for_read(state, org_path, slug, Some(auth)).await?;

    let (branch_count, tag_count, open_issue_count, has_pipelines, latest_pipeline_status) = tokio::join!(
        async {
            explorer::list_branches(&repo_path)
                .await
                .map(|branches| branches.len() as u32)
                .unwrap_or(0)
        },
        async {
            explorer::list_tags(&repo_path)
                .await
                .map(|tags| tags.len() as u32)
                .unwrap_or(0)
        },
        open_issue_count(&state.pool, repo.id),
        cicd::repository_has_ci(&repo_path, &repo.default_branch, repo.id, &state.pool),
        latest_pipeline_status(&state.pool, repo.id),
    );

    Ok(ProjectStats {
        org_path: org_path.to_string(),
        slug: slug.to_string(),
        branch_count,
        tag_count,
        open_issue_count,
        has_pipelines,
        latest_pipeline_status,
    })
}

async fn open_issue_count(pool: &sqlx::PgPool, repository_id: Uuid) -> i64 {
    sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM issues WHERE repository_id = $1 AND state = 'open'",
    )
    .bind(repository_id)
    .fetch_one(pool)
    .await
    .unwrap_or(0)
}

async fn latest_pipeline_status(pool: &sqlx::PgPool, repository_id: Uuid) -> Option<String> {
    sqlx::query_scalar::<_, String>(
        r#"
        SELECT CASE
            WHEN pr.status = 'running'
                 AND NOT EXISTS (
                     SELECT 1 FROM job_runs j
                     WHERE j.pipeline_run_id = pr.id
                       AND j.status IN ('queued', 'running')
                 )
                 AND EXISTS (
                     SELECT 1 FROM job_runs j
                     WHERE j.pipeline_run_id = pr.id
                       AND j.status::text = 'manual'
                 )
            THEN 'success'
            ELSE pr.status::text
        END
        FROM pipeline_runs pr
        WHERE pr.repository_id = $1
        ORDER BY pr.created_at DESC
        LIMIT 1
        "#,
    )
    .bind(repository_id)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten()
}
