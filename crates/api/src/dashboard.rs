use axum::{
    extract::State,
    routing::post,
    Json, Router,
};
use pertisk_git::explorer;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{cicd, load_repo_for_read, ApiError, AppState, AuthUser};

const MAX_PROJECTS: usize = 50;

pub fn dashboard_routes() -> Router<AppState> {
    Router::new().route("/dashboard/project-stats", post(project_stats))
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
