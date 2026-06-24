use std::path::{Path as FsPath, PathBuf};
use std::sync::Arc;

use axum::{
    body::Body,
    extract::{Path, Query, State},
    http::{header, HeaderMap, StatusCode},
    response::Response,
    routing::{delete, get, post},
    Json, Router,
};
use chrono::{DateTime, Utc};
use pertisk_cicd::{
    parse_pipeline_yaml, PipelineEvent, Scheduler, TriggerMatcher, CONFIG_PATHS,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::PgPool;
use tokio::process::Command;
use uuid::Uuid;

use crate::{
    ensure_can_write_repo, load_repo_for_read, ApiError, AppState, AuthUser,
};

fn sqlx_error(err: sqlx::Error) -> ApiError {
    pertisk_domain::DomainError::Internal(err.to_string()).into()
}

pub fn cicd_read_routes() -> Router<AppState> {
    Router::new()
        .route(
            "/organizations/{org_slug}/repositories/{repo_slug}/pipelines",
            get(list_pipeline_runs),
        )
        .route(
            "/organizations/{org_slug}/repositories/{repo_slug}/pipelines/{run_id}",
            get(get_pipeline_run),
        )
        .route(
            "/organizations/{org_slug}/repositories/{repo_slug}/commits/{commit_sha}/statuses",
            get(list_commit_statuses),
        )
}

pub fn cicd_write_routes() -> Router<AppState> {
    Router::new()
        .route("/runners", get(list_runners))
        .route(
            "/organizations/{org_slug}/repositories/{repo_slug}/pipelines/trigger",
            post(trigger_pipeline),
        )
        .route("/runners/register", post(register_runner))
        .route("/runners/{runner_id}", delete(delete_runner))
        .route("/runners/{runner_id}/rotate-token", post(rotate_runner_token))
}

pub fn runner_routes() -> Router<AppState> {
    Router::new()
        .route("/runner/jobs", get(poll_runner_job))
        .route("/runner/jobs/{job_id}/start", post(start_runner_job))
        .route("/runner/jobs/{job_id}/complete", post(complete_runner_job))
        .route("/runner/heartbeat", post(runner_heartbeat))
        .route(
            "/runner/repos/{org_slug}/{repo_slug}/workspace",
            get(runner_workspace),
        )
        .route("/runner/jobs/{job_id}/workspace", get(runner_job_workspace))
}

pub fn post_receive_hook(
    state: AppState,
) -> Arc<
    dyn Fn(
            Uuid,
            PathBuf,
            Vec<pertisk_git::RefUpdate>,
        ) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send + 'static>>
        + Send
        + Sync,
> {
    Arc::new(move |repository_id, _repo_path, updates| {
        let state = state.clone();
        Box::pin(async move {
            if let Err(err) = enqueue_push_triggers(&state, repository_id, &updates).await {
                tracing::warn!("failed to enqueue pipeline triggers: {err:#}");
                return;
            }
            if let Err(err) = flush_pending_triggers(&state).await {
                tracing::warn!("failed to process pipeline triggers: {err:#}");
            }
        })
    })
}

#[derive(Serialize)]
struct PipelineRunResponse {
    id: Uuid,
    commit_sha: String,
    ref_name: String,
    event_type: String,
    status: String,
    created_at: DateTime<Utc>,
    started_at: Option<DateTime<Utc>>,
    finished_at: Option<DateTime<Utc>>,
    jobs: Vec<JobRunResponse>,
}

#[derive(Serialize)]
struct JobRunResponse {
    id: Uuid,
    job_name: String,
    status: String,
    runs_on: String,
    metrics_json: Option<Value>,
    log_text: String,
    queued_at: DateTime<Utc>,
    started_at: Option<DateTime<Utc>>,
    finished_at: Option<DateTime<Utc>>,
}

#[derive(Serialize)]
struct CommitStatusResponse {
    context: String,
    state: String,
    description: Option<String>,
    target_url: Option<String>,
    updated_at: DateTime<Utc>,
}

#[derive(Deserialize)]
struct TriggerPipelineRequest {
    commit_sha: String,
    ref_name: String,
    event_type: Option<String>,
}

#[derive(Deserialize)]
struct RegisterRunnerRequest {
    name: String,
    labels: Option<Vec<String>>,
}

#[derive(Serialize)]
struct RegisterRunnerResponse {
    runner_id: Uuid,
    token: String,
}

#[derive(Serialize)]
struct RunnerResponse {
    id: Uuid,
    name: String,
    labels: Vec<String>,
    status: String,
    last_seen_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
}

#[derive(Serialize)]
struct RotateRunnerTokenResponse {
    token: String,
}

#[derive(Deserialize)]
struct PollQuery {
    timeout_secs: Option<u64>,
}

#[derive(Serialize)]
struct PollJobResponse {
    job_id: Uuid,
    pipeline_run_id: Uuid,
    job_name: String,
    repository_id: Uuid,
    org_slug: String,
    repo_slug: String,
    commit_sha: String,
    ref_name: String,
    steps: Value,
}

#[derive(Deserialize)]
struct CompleteJobRequest {
    status: String,
    log_text: Option<String>,
    metrics_json: Option<Value>,
}

async fn list_pipeline_runs(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_slug, repo_slug)): Path<(String, String)>,
) -> Result<Json<Vec<PipelineRunResponse>>, ApiError> {
    let (_org, repo, _path) = load_repo_for_read(&state, &org_slug, &repo_slug, Some(&auth)).await?;

    let runs = sqlx::query_as::<_, PipelineRunRow>(
        r#"
        SELECT id, commit_sha, ref_name, event_type::text, status::text, created_at, started_at, finished_at
        FROM pipeline_runs
        WHERE repository_id = $1
        ORDER BY created_at DESC
        LIMIT 50
        "#,
    )
    .bind(repo.id)
    .fetch_all(&state.pool)
    .await
    .map_err(sqlx_error)?;

    let mut out = Vec::with_capacity(runs.len());
    for run in runs {
        let jobs = fetch_job_runs(&state.pool, run.id).await.map_err(sqlx_error)?;
        out.push(run.into_response(jobs));
    }
    Ok(Json(out))
}

async fn get_pipeline_run(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_slug, repo_slug, run_id)): Path<(String, String, Uuid)>,
) -> Result<Json<PipelineRunResponse>, ApiError> {
    let (_org, repo, _path) = load_repo_for_read(&state, &org_slug, &repo_slug, Some(&auth)).await?;

    let run = fetch_pipeline_run(&state.pool, repo.id, run_id)
        .await
        .map_err(sqlx_error)?
        .ok_or(pertisk_domain::DomainError::NotFound)?;
    let jobs = fetch_job_runs(&state.pool, run.id).await.map_err(sqlx_error)?;
    Ok(Json(run.into_response(jobs)))
}

async fn list_commit_statuses(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_slug, repo_slug, commit_sha)): Path<(String, String, String)>,
) -> Result<Json<Vec<CommitStatusResponse>>, ApiError> {
    let (_org, repo, _path) = load_repo_for_read(&state, &org_slug, &repo_slug, Some(&auth)).await?;

    let rows = sqlx::query_as::<_, CommitStatusRow>(
        r#"
        SELECT context, state::text, description, target_url, updated_at
        FROM commit_statuses
        WHERE repository_id = $1 AND commit_sha = $2
        ORDER BY context
        "#,
    )
    .bind(repo.id)
    .bind(commit_sha)
    .fetch_all(&state.pool)
    .await
    .map_err(sqlx_error)?;

    Ok(Json(
        rows.into_iter()
            .map(|row| CommitStatusResponse {
                context: row.context,
                state: row.state,
                description: row.description,
                target_url: row.target_url,
                updated_at: row.updated_at,
            })
            .collect(),
    ))
}

async fn trigger_pipeline(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_slug, repo_slug)): Path<(String, String)>,
    Json(body): Json<TriggerPipelineRequest>,
) -> Result<Json<PipelineRunResponse>, ApiError> {
    let (_org, repo, _path) = load_repo_for_read(&state, &org_slug, &repo_slug, Some(&auth)).await?;
    ensure_can_write_repo(&state, &org_slug, &repo, &auth).await?;

    let event_type = body.event_type.as_deref().unwrap_or("manual");
    let run_id = process_trigger_now(
        &state,
        repo.id,
        &org_slug,
        &repo_slug,
        &body.commit_sha,
        &body.ref_name,
        event_type,
    )
    .await
    .map_err(|e| match e {
        sqlx::Error::RowNotFound => {
            pertisk_domain::DomainError::Validation(
                "no matching pipeline config (.pertisk-ci.yaml) for this event".into(),
            )
            .into()
        }
        sqlx::Error::Protocol(msg) => pertisk_domain::DomainError::Validation(msg.to_string()).into(),
        other => sqlx_error(other),
    })?;

    let run = fetch_pipeline_run(&state.pool, repo.id, run_id)
        .await
        .map_err(sqlx_error)?
        .ok_or(pertisk_domain::DomainError::NotFound)?;
    let jobs = fetch_job_runs(&state.pool, run.id).await.map_err(sqlx_error)?;
    Ok(Json(run.into_response(jobs)))
}

async fn list_runners(
    State(state): State<AppState>,
    _auth: AuthUser,
) -> Result<Json<Vec<RunnerResponse>>, ApiError> {
    let rows = sqlx::query_as::<_, RunnerRow>(
        r#"
        SELECT id, name, labels, status::text, last_seen_at, created_at
        FROM runners
        ORDER BY created_at DESC
        "#,
    )
    .fetch_all(&state.pool)
    .await
    .map_err(sqlx_error)?;

    Ok(Json(
        rows.into_iter()
            .map(|row| RunnerResponse {
                id: row.id,
                name: row.name,
                labels: row.labels,
                status: row.status,
                last_seen_at: row.last_seen_at,
                created_at: row.created_at,
            })
            .collect(),
    ))
}

async fn register_runner(
    State(state): State<AppState>,
    _auth: AuthUser,
    Json(body): Json<RegisterRunnerRequest>,
) -> Result<Json<RegisterRunnerResponse>, ApiError> {
    let name = body.name.trim();
    if name.is_empty() {
        return Err(pertisk_domain::DomainError::Validation("runner name is required".into()).into());
    }

    let labels = body.labels.unwrap_or_else(|| vec!["self-hosted".into()]);
    let token = format!("ptr_{}", Uuid::new_v4().simple());
    let token_hash = hash_runner_token(&token);

    let runner_id = sqlx::query_scalar::<_, Uuid>(
        r#"
        INSERT INTO runners (name, token_hash, labels, status)
        VALUES ($1, $2, $3, 'offline')
        RETURNING id
        "#,
    )
    .bind(name)
    .bind(token_hash)
    .bind(&labels)
    .fetch_one(&state.pool)
    .await
    .map_err(sqlx_error)?;

    Ok(Json(RegisterRunnerResponse { runner_id, token }))
}

async fn delete_runner(
    State(state): State<AppState>,
    _auth: AuthUser,
    Path(runner_id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    let result = sqlx::query("DELETE FROM runners WHERE id = $1")
        .bind(runner_id)
        .execute(&state.pool)
        .await
        .map_err(sqlx_error)?;

    if result.rows_affected() == 0 {
        return Err(pertisk_domain::DomainError::NotFound.into());
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn rotate_runner_token(
    State(state): State<AppState>,
    _auth: AuthUser,
    Path(runner_id): Path<Uuid>,
) -> Result<Json<RotateRunnerTokenResponse>, ApiError> {
    let token = format!("ptr_{}", Uuid::new_v4().simple());
    let token_hash = hash_runner_token(&token);

    let updated = sqlx::query(
        r#"
        UPDATE runners
        SET token_hash = $2, status = 'offline', last_seen_at = NULL
        WHERE id = $1
        "#,
    )
    .bind(runner_id)
    .bind(token_hash)
    .execute(&state.pool)
    .await
    .map_err(sqlx_error)?;

    if updated.rows_affected() == 0 {
        return Err(pertisk_domain::DomainError::NotFound.into());
    }

    Ok(Json(RotateRunnerTokenResponse { token }))
}

async fn poll_runner_job(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<PollQuery>,
) -> Result<Json<Option<PollJobResponse>>, (StatusCode, String)> {
    let runner_id = authenticate_runner(&state.pool, &headers).await?;
    let timeout = query.timeout_secs.unwrap_or(25).min(60);
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(timeout);

    loop {
        if let Some(job) = claim_next_job(&state.pool, runner_id).await.map_err(|e| internal(e.to_string()))? {
            let meta = sqlx::query_as::<_, JobPollRow>(
                r#"
                SELECT
                    j.id,
                    j.pipeline_run_id,
                    j.job_name,
                    j.steps_json,
                    p.repository_id,
                    p.commit_sha,
                    p.ref_name,
                    o.slug AS org_slug,
                    r.slug AS repo_slug
                FROM job_runs j
                INNER JOIN pipeline_runs p ON p.id = j.pipeline_run_id
                INNER JOIN repositories r ON r.id = p.repository_id
                INNER JOIN organizations o ON o.id = r.organization_id
                WHERE j.id = $1
                "#,
            )
            .bind(job)
            .fetch_one(&state.pool)
            .await
            .map_err(|e| internal(e.to_string()))?;

            return Ok(Json(Some(PollJobResponse {
                job_id: meta.id,
                pipeline_run_id: meta.pipeline_run_id,
                job_name: meta.job_name,
                repository_id: meta.repository_id,
                org_slug: meta.org_slug,
                repo_slug: meta.repo_slug,
                commit_sha: meta.commit_sha,
                ref_name: meta.ref_name,
                steps: meta.steps_json,
            })));
        }

        if tokio::time::Instant::now() >= deadline {
            return Ok(Json(None));
        }
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }
}

async fn start_runner_job(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(job_id): Path<Uuid>,
) -> Result<StatusCode, (StatusCode, String)> {
    let runner_id = authenticate_runner(&state.pool, &headers).await?;
    let updated = sqlx::query(
        r#"
        UPDATE job_runs
        SET status = 'running', started_at = COALESCE(started_at, NOW())
        WHERE id = $1 AND runner_id = $2 AND status IN ('queued', 'running')
        "#,
    )
    .bind(job_id)
    .bind(runner_id)
    .execute(&state.pool)
    .await
    .map_err(|e| internal(e.to_string()))?;

    if updated.rows_affected() == 0 {
        return Err((StatusCode::NOT_FOUND, "job not found".into()));
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn complete_runner_job(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(job_id): Path<Uuid>,
    Json(body): Json<CompleteJobRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    let runner_id = authenticate_runner(&state.pool, &headers).await?;
    let status = match body.status.as_str() {
        "success" => "success",
        "failure" => "failure",
        "cancelled" => "cancelled",
        other => return Err((StatusCode::BAD_REQUEST, format!("invalid status: {other}"))),
    };

    let row = sqlx::query_as::<_, (Uuid, Uuid, String)>(
        r#"
        UPDATE job_runs
        SET status = $3::job_run_status,
            log_text = COALESCE($4, log_text),
            metrics_json = COALESCE($5, metrics_json),
            finished_at = NOW()
        WHERE id = $1 AND runner_id = $2
        RETURNING pipeline_run_id, pipeline_run_id, job_name
        "#,
    )
    .bind(job_id)
    .bind(runner_id)
    .bind(status)
    .bind(body.log_text)
    .bind(body.metrics_json)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| internal(e.to_string()))?
    .ok_or((StatusCode::NOT_FOUND, "job not found".into()))?;

    let pipeline_run_id = row.0;
    let job_name = row.2;
    update_commit_status_for_job(&state.pool, job_id, status, &job_name)
        .await
        .map_err(|e| internal(e.to_string()))?;
    finalize_pipeline_run_if_done(&state.pool, pipeline_run_id)
        .await
        .map_err(|e| internal(e.to_string()))?;

    sqlx::query("UPDATE runners SET status = 'online', last_seen_at = NOW() WHERE id = $1")
        .bind(runner_id)
        .execute(&state.pool)
        .await
        .map_err(|e| internal(e.to_string()))?;

    Ok(StatusCode::NO_CONTENT)
}

async fn runner_heartbeat(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<StatusCode, (StatusCode, String)> {
    let runner_id = authenticate_runner(&state.pool, &headers).await?;
    sqlx::query("UPDATE runners SET status = 'online', last_seen_at = NOW() WHERE id = $1")
        .bind(runner_id)
        .execute(&state.pool)
        .await
        .map_err(|e| internal(e.to_string()))?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct WorkspaceQuery {
    commit_sha: String,
}

async fn runner_workspace(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((org_slug, repo_slug)): Path<(String, String)>,
    Query(query): Query<WorkspaceQuery>,
) -> Result<Response, (StatusCode, String)> {
    let runner_id = authenticate_runner(&state.pool, &headers).await?;

    let allowed = sqlx::query_scalar::<_, bool>(
        r#"
        SELECT EXISTS(
            SELECT 1
            FROM job_runs j
            INNER JOIN pipeline_runs p ON p.id = j.pipeline_run_id
            INNER JOIN repositories r ON r.id = p.repository_id
            INNER JOIN organizations o ON o.id = r.organization_id
            WHERE j.runner_id = $1
              AND j.status IN ('queued', 'running')
              AND o.slug = $2
              AND r.slug = $3
              AND p.commit_sha = $4
        )
        "#,
    )
    .bind(runner_id)
    .bind(&org_slug)
    .bind(&repo_slug)
    .bind(&query.commit_sha)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| internal(e.to_string()))?;

    if !allowed {
        return Err((
            StatusCode::FORBIDDEN,
            "no active job for this repository and commit".into(),
        ));
    }

    let repo_path =
        pertisk_git::config::repo_disk_path(&state.config.repos_root, &org_slug, &repo_slug);
    serve_runner_workspace(&state, &repo_path, &org_slug, &repo_slug, &query.commit_sha).await
}

async fn runner_job_workspace(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(job_id): Path<Uuid>,
) -> Result<Response, (StatusCode, String)> {
    let runner_id = authenticate_runner(&state.pool, &headers).await?;

    let meta = sqlx::query_as::<_, (String, String, String)>(
        r#"
        SELECT o.slug, r.slug, p.commit_sha
        FROM job_runs j
        INNER JOIN pipeline_runs p ON p.id = j.pipeline_run_id
        INNER JOIN repositories r ON r.id = p.repository_id
        INNER JOIN organizations o ON o.id = r.organization_id
        WHERE j.id = $1
          AND j.runner_id = $2
          AND j.status IN ('queued', 'running')
        "#,
    )
    .bind(job_id)
    .bind(runner_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| internal(e.to_string()))?
    .ok_or((StatusCode::NOT_FOUND, "job not found".into()))?;

    let (org_slug, repo_slug, commit_sha) = meta;
    let repo_path =
        pertisk_git::config::repo_disk_path(&state.config.repos_root, &org_slug, &repo_slug);
    serve_runner_workspace(&state, &repo_path, &org_slug, &repo_slug, &commit_sha).await
}

async fn serve_runner_workspace(
    state: &AppState,
    repo_path: &FsPath,
    org_slug: &str,
    repo_slug: &str,
    commit_sha: &str,
) -> Result<Response, (StatusCode, String)> {
    if !pertisk_git::repo_exists_on_disk(&state.config.repos_root, org_slug, repo_slug) {
        pertisk_git::storage::ensure_bare_repo(&state.config.repos_root, org_slug, repo_slug)
            .await
            .map_err(|e| internal(e.to_string()))?;
    }

    if !repo_path.join("HEAD").exists() {
        return Err((
            StatusCode::NOT_FOUND,
            format!(
                "bare repository not on server at {}; verify REPOS_ROOT={} on pertisk-api",
                repo_path.display(),
                state.config.repos_root.display()
            ),
        ));
    }

    let archive = pertisk_git::workspace::archive_commit(repo_path, commit_sha)
        .await
        .map_err(|e| internal(e.to_string()))?;

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/gzip")
        .body(Body::from(archive))
        .map_err(|e| internal(e.to_string()))
}

pub async fn enqueue_push_triggers(
    state: &AppState,
    repository_id: Uuid,
    updates: &[pertisk_git::RefUpdate],
) -> anyhow::Result<()> {
    for update in updates {
        if update.new_sha.chars().all(|c| c == '0') {
            continue;
        }

        insert_trigger(
            &state.pool,
            repository_id,
            &update.new_sha,
            &update.ref_name,
            "push",
            None,
        )
        .await?;

        if let Some(branch) = update.ref_name.strip_prefix("refs/heads/") {
            if let Err(err) = enqueue_pull_request_triggers_for_branch(
                &state.pool,
                repository_id,
                branch,
                &update.new_sha,
            )
            .await
            {
                tracing::warn!(
                    branch = %branch,
                    "failed to enqueue pull_request pipeline triggers: {err:#}"
                );
            }
        }
    }
    Ok(())
}

/// Enqueue `pull_request` triggers for open PRs whose source branch matches `source_branch`.
pub async fn enqueue_pull_request_triggers_for_branch(
    pool: &PgPool,
    repository_id: Uuid,
    source_branch: &str,
    head_sha: &str,
) -> Result<(), sqlx::Error> {
    let prs = sqlx::query_as::<_, (i32, String)>(
        r#"
        SELECT number, target_branch
        FROM pull_requests
        WHERE repository_id = $1
          AND state = 'open'
          AND source_branch = $2
        "#,
    )
    .bind(repository_id)
    .bind(source_branch)
    .fetch_all(pool)
    .await?;

    for (number, target_branch) in prs {
        insert_trigger(
            pool,
            repository_id,
            head_sha,
            &format!("refs/heads/{target_branch}"),
            "pull_request",
            Some(number),
        )
        .await?;
    }
    Ok(())
}

/// Block merge when CI statuses exist and any are pending or failed.
pub async fn ensure_ci_passed_for_commit(
    pool: &PgPool,
    repository_id: Uuid,
    commit_sha: &str,
) -> Result<(), pertisk_domain::DomainError> {
    let rows = sqlx::query_as::<_, (String, String)>(
        r#"
        SELECT context, state::text
        FROM commit_statuses
        WHERE repository_id = $1 AND commit_sha = $2
        "#,
    )
    .bind(repository_id)
    .bind(commit_sha)
    .fetch_all(pool)
    .await
    .map_err(|e| pertisk_domain::DomainError::Internal(e.to_string()))?;

    if rows.is_empty() {
        return Ok(());
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
        return Err(pertisk_domain::DomainError::Validation(format!(
            "CI checks failed: {}",
            failed.join(", ")
        )));
    }
    if !pending.is_empty() {
        return Err(pertisk_domain::DomainError::Validation(format!(
            "CI checks still running: {}",
            pending.join(", ")
        )));
    }
    Ok(())
}

/// Process queued pipeline triggers immediately (push path; worker also polls as backup).
pub async fn flush_pending_triggers(state: &AppState) -> anyhow::Result<u32> {
    let mut processed = 0u32;
    loop {
        let triggers = sqlx::query_as::<_, PendingTriggerRow>(
            r#"
            SELECT id, repository_id, commit_sha, ref_name, event_type::text
            FROM pipeline_triggers
            WHERE processed = FALSE
            ORDER BY created_at ASC
            LIMIT 20
            "#,
        )
        .fetch_all(&state.pool)
        .await?;

        if triggers.is_empty() {
            break;
        }

        for trigger in triggers {
            if let Some((org_slug, repo_slug)) =
                repo_slugs(&state.pool, trigger.repository_id).await?
            {
                match process_trigger_now(
                    state,
                    trigger.repository_id,
                    &org_slug,
                    &repo_slug,
                    &trigger.commit_sha,
                    &trigger.ref_name,
                    &trigger.event_type,
                )
                .await
                {
                    Ok(run_id) => {
                        tracing::info!(
                            run_id = %run_id,
                            event = %trigger.event_type,
                            repo = %format!("{org_slug}/{repo_slug}"),
                            "pipeline triggered by push"
                        );
                    }
                    Err(err) => {
                        let reason = err.to_string();
                        if reason.contains("RowNotFound") || reason.contains("no matching") {
                            tracing::info!(
                                trigger_id = %trigger.id,
                                commit = %trigger.commit_sha,
                                ref_name = %trigger.ref_name,
                                event = %trigger.event_type,
                                repo = %format!("{org_slug}/{repo_slug}"),
                                "pipeline trigger skipped (no .pertisk-ci.yaml at commit or branch filter)"
                            );
                        } else {
                            tracing::warn!(
                                trigger_id = %trigger.id,
                                event = %trigger.event_type,
                                repo = %format!("{org_slug}/{repo_slug}"),
                                "pipeline trigger failed: {reason}"
                            );
                        }
                    }
                }
            }
            sqlx::query("UPDATE pipeline_triggers SET processed = TRUE WHERE id = $1")
                .bind(trigger.id)
                .execute(&state.pool)
                .await?;
            processed += 1;
        }
    }
    Ok(processed)
}

async fn repo_slugs(pool: &PgPool, repository_id: Uuid) -> anyhow::Result<Option<(String, String)>> {
    Ok(sqlx::query_as::<_, (String, String)>(
        r#"
        SELECT o.slug, r.slug
        FROM repositories r
        INNER JOIN organizations o ON o.id = r.organization_id
        WHERE r.id = $1
        "#,
    )
    .bind(repository_id)
    .fetch_optional(pool)
    .await?)
}

#[derive(sqlx::FromRow)]
struct PendingTriggerRow {
    id: Uuid,
    repository_id: Uuid,
    commit_sha: String,
    ref_name: String,
    event_type: String,
}

async fn process_trigger_now(
    state: &AppState,
    repository_id: Uuid,
    org_slug: &str,
    repo_slug: &str,
    commit_sha: &str,
    ref_name: &str,
    event_type: &str,
) -> Result<Uuid, sqlx::Error> {
    let repo_path = pertisk_git::config::repo_disk_path(&state.config.repos_root, org_slug, repo_slug);
    let Some((config_yaml, config_path)) = read_pipeline_config(&repo_path, commit_sha).await else {
        return Err(sqlx::Error::RowNotFound);
    };

    let config = parse_pipeline_yaml(&config_yaml).map_err(|e| {
        sqlx::Error::Protocol(format!("invalid pipeline config: {e}").into())
    })?;

    let event = match event_type {
        "pull_request" => PipelineEvent::PullRequest {
            target_branch: ref_name.strip_prefix("refs/heads/").unwrap_or(ref_name).into(),
        },
        _ => PipelineEvent::Push {
            branch: ref_name.strip_prefix("refs/heads/").unwrap_or(ref_name).into(),
            tag: ref_name
                .strip_prefix("refs/tags/")
                .map(|tag| tag.to_string()),
        },
    };

    if !TriggerMatcher::matches(&config, &event) {
        return Err(sqlx::Error::RowNotFound);
    }

    let run_id = sqlx::query_scalar::<_, Uuid>(
        r#"
        INSERT INTO pipeline_runs (repository_id, commit_sha, ref_name, event_type, status, config_path, started_at)
        VALUES ($1, $2, $3, $4::pipeline_event_type, 'queued', $5, NOW())
        RETURNING id
        "#,
    )
    .bind(repository_id)
    .bind(commit_sha)
    .bind(ref_name)
    .bind(event_type)
    .bind(config_path)
    .fetch_one(&state.pool)
    .await?;

    let jobs = Scheduler::schedule(&config).map_err(|e| {
        sqlx::Error::Protocol(format!("schedule failed: {e}").into())
    })?;

    for job in jobs {
        let steps_json = serde_json::to_value(&job.job.steps).unwrap_or(Value::Array(vec![]));
        let job_run_id = sqlx::query_scalar::<_, Uuid>(
            r#"
            INSERT INTO job_runs (pipeline_run_id, job_name, runs_on, steps_json, needs, status)
            VALUES ($1, $2, $3, $4, $5, 'queued')
            RETURNING id
            "#,
        )
        .bind(run_id)
        .bind(&job.name)
        .bind(&job.job.runs_on)
        .bind(steps_json)
        .bind(&job.job.needs)
        .fetch_one(&state.pool)
        .await?;

        sqlx::query(
            r#"
            INSERT INTO commit_statuses (repository_id, commit_sha, context, state, description, pipeline_run_id)
            VALUES ($1, $2, $3, 'pending', 'Queued', $4)
            ON CONFLICT (repository_id, commit_sha, context)
            DO UPDATE SET state = 'pending', description = 'Queued', updated_at = NOW(), pipeline_run_id = EXCLUDED.pipeline_run_id
            "#,
        )
        .bind(repository_id)
        .bind(commit_sha)
        .bind(format!("ci/{}", job.name))
        .bind(run_id)
        .execute(&state.pool)
        .await?;
        let _ = job_run_id;
    }

    sqlx::query("UPDATE pipeline_runs SET status = 'running' WHERE id = $1")
        .bind(run_id)
        .execute(&state.pool)
        .await?;

    Ok(run_id)
}

async fn read_pipeline_config(repo_path: &FsPath, commit_sha: &str) -> Option<(String, String)> {
    for path in CONFIG_PATHS {
        let output = Command::new("git")
            .current_dir(repo_path)
            .args(["show", &format!("{commit_sha}:{path}")])
            .output()
            .await;
        if let Ok(out) = output {
            if out.status.success() {
                let yaml = String::from_utf8_lossy(&out.stdout).into_owned();
                if !yaml.trim().is_empty() {
                    return Some((yaml, (*path).to_string()));
                }
            }
        }
    }
    None
}

async fn insert_trigger(
    pool: &PgPool,
    repository_id: Uuid,
    commit_sha: &str,
    ref_name: &str,
    event_type: &str,
    pull_request_number: Option<i32>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        INSERT INTO pipeline_triggers (repository_id, commit_sha, ref_name, event_type, pull_request_number)
        VALUES ($1, $2, $3, $4::pipeline_event_type, $5)
        "#,
    )
    .bind(repository_id)
    .bind(commit_sha)
    .bind(ref_name)
    .bind(event_type)
    .bind(pull_request_number)
    .execute(pool)
    .await?;
    Ok(())
}

async fn claim_next_job(pool: &PgPool, runner_id: Uuid) -> Result<Option<Uuid>, sqlx::Error> {
    let mut tx = pool.begin().await?;
    let job = sqlx::query_scalar::<_, Uuid>(
        r#"
        SELECT j.id
        FROM job_runs j
        INNER JOIN runners r ON r.id = $1
        WHERE j.status = 'queued'
          AND j.runs_on = ANY(r.labels)
          AND NOT EXISTS (
            SELECT 1
            FROM job_runs dep
            WHERE dep.pipeline_run_id = j.pipeline_run_id
              AND dep.job_name = ANY(j.needs)
              AND dep.status <> 'success'
          )
        ORDER BY j.queued_at ASC
        FOR UPDATE OF j SKIP LOCKED
        LIMIT 1
        "#,
    )
    .bind(runner_id)
    .fetch_optional(&mut *tx)
    .await?;

    let Some(job_id) = job else {
        tx.rollback().await?;
        return Ok(None);
    };

    sqlx::query(
        r#"
        UPDATE job_runs
        SET status = 'running', runner_id = $2, started_at = NOW()
        WHERE id = $1
        "#,
    )
    .bind(job_id)
    .bind(runner_id)
    .execute(&mut *tx)
    .await?;

    sqlx::query("UPDATE runners SET status = 'busy', last_seen_at = NOW() WHERE id = $1")
        .bind(runner_id)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;
    Ok(Some(job_id))
}

async fn update_commit_status_for_job(
    pool: &PgPool,
    job_id: Uuid,
    status: &str,
    job_name: &str,
) -> Result<(), sqlx::Error> {
    let state = match status {
        "success" => "success",
        _ => "failure",
    };
    sqlx::query(
        r#"
        UPDATE commit_statuses cs
        SET state = $3::commit_status_state,
            description = $4,
            updated_at = NOW()
        FROM job_runs j
        INNER JOIN pipeline_runs p ON p.id = j.pipeline_run_id
        WHERE j.id = $1
          AND cs.pipeline_run_id = p.id
          AND cs.context = $2
        "#,
    )
    .bind(job_id)
    .bind(format!("ci/{job_name}"))
    .bind(state)
    .bind(format!("Job {status}"))
    .execute(pool)
    .await?;
    Ok(())
}

async fn finalize_pipeline_run_if_done(pool: &PgPool, pipeline_run_id: Uuid) -> Result<(), sqlx::Error> {
    let running = sqlx::query_scalar::<_, i64>(
        r#"
        SELECT COUNT(*) FROM job_runs
        WHERE pipeline_run_id = $1 AND status = 'running'
        "#,
    )
    .bind(pipeline_run_id)
    .fetch_one(pool)
    .await?;

    if running > 0 {
        return Ok(());
    }

    let failed = sqlx::query_scalar::<_, i64>(
        r#"
        SELECT COUNT(*) FROM job_runs
        WHERE pipeline_run_id = $1 AND status = 'failure'
        "#,
    )
    .bind(pipeline_run_id)
    .fetch_one(pool)
    .await?;

    if failed > 0 {
        sqlx::query(
            r#"
            UPDATE pipeline_runs
            SET status = 'failure'::pipeline_run_status, finished_at = NOW()
            WHERE id = $1 AND status IN ('pending', 'queued', 'running')
            "#,
        )
        .bind(pipeline_run_id)
        .execute(pool)
        .await?;
        return Ok(());
    }

    let remaining = sqlx::query_scalar::<_, i64>(
        r#"
        SELECT COUNT(*) FROM job_runs
        WHERE pipeline_run_id = $1 AND status IN ('queued', 'running')
        "#,
    )
    .bind(pipeline_run_id)
    .fetch_one(pool)
    .await?;

    if remaining > 0 {
        return Ok(());
    }

    sqlx::query(
        r#"
        UPDATE pipeline_runs
        SET status = 'success'::pipeline_run_status, finished_at = NOW()
        WHERE id = $1
        "#,
    )
    .bind(pipeline_run_id)
    .execute(pool)
    .await?;
    Ok(())
}

#[derive(sqlx::FromRow)]
struct PipelineRunRow {
    id: Uuid,
    commit_sha: String,
    ref_name: String,
    event_type: String,
    status: String,
    created_at: DateTime<Utc>,
    started_at: Option<DateTime<Utc>>,
    finished_at: Option<DateTime<Utc>>,
}

impl PipelineRunRow {
    fn into_response(self, jobs: Vec<JobRunResponse>) -> PipelineRunResponse {
        PipelineRunResponse {
            id: self.id,
            commit_sha: self.commit_sha,
            ref_name: self.ref_name,
            event_type: self.event_type,
            status: self.status,
            created_at: self.created_at,
            started_at: self.started_at,
            finished_at: self.finished_at,
            jobs,
        }
    }
}

#[derive(sqlx::FromRow)]
struct JobRunRow {
    id: Uuid,
    job_name: String,
    status: String,
    runs_on: String,
    metrics_json: Option<Value>,
    log_text: String,
    queued_at: DateTime<Utc>,
    started_at: Option<DateTime<Utc>>,
    finished_at: Option<DateTime<Utc>>,
}

async fn fetch_job_runs(pool: &PgPool, pipeline_run_id: Uuid) -> Result<Vec<JobRunResponse>, sqlx::Error> {
    let rows = sqlx::query_as::<_, JobRunRow>(
        r#"
        SELECT id, job_name, status::text, runs_on, metrics_json, log_text, queued_at, started_at, finished_at
        FROM job_runs
        WHERE pipeline_run_id = $1
        ORDER BY queued_at ASC
        "#,
    )
    .bind(pipeline_run_id)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| JobRunResponse {
            id: row.id,
            job_name: row.job_name,
            status: row.status,
            runs_on: row.runs_on,
            metrics_json: row.metrics_json,
            log_text: row.log_text,
            queued_at: row.queued_at,
            started_at: row.started_at,
            finished_at: row.finished_at,
        })
        .collect())
}

async fn fetch_pipeline_run(
    pool: &PgPool,
    repository_id: Uuid,
    run_id: Uuid,
) -> Result<Option<PipelineRunRow>, sqlx::Error> {
    sqlx::query_as::<_, PipelineRunRow>(
        r#"
        SELECT id, commit_sha, ref_name, event_type::text, status::text, created_at, started_at, finished_at
        FROM pipeline_runs
        WHERE id = $1 AND repository_id = $2
        "#,
    )
    .bind(run_id)
    .bind(repository_id)
    .fetch_optional(pool)
    .await
}

#[derive(sqlx::FromRow)]
struct RunnerRow {
    id: Uuid,
    name: String,
    labels: Vec<String>,
    status: String,
    last_seen_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
}

#[derive(sqlx::FromRow)]
struct CommitStatusRow {
    context: String,
    state: String,
    description: Option<String>,
    target_url: Option<String>,
    updated_at: DateTime<Utc>,
}

#[derive(sqlx::FromRow)]
struct JobPollRow {
    id: Uuid,
    pipeline_run_id: Uuid,
    job_name: String,
    steps_json: Value,
    repository_id: Uuid,
    commit_sha: String,
    ref_name: String,
    org_slug: String,
    repo_slug: String,
}

fn hash_runner_token(token: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    token.hash(&mut hasher);
    format!("{:x}", hasher.finish())
}

async fn authenticate_runner(pool: &PgPool, headers: &HeaderMap) -> Result<Uuid, (StatusCode, String)> {
    let token = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .ok_or((StatusCode::UNAUTHORIZED, "missing runner token".into()))?;
    let token_hash = hash_runner_token(token);
    sqlx::query_scalar::<_, Uuid>("SELECT id FROM runners WHERE token_hash = $1")
        .bind(token_hash)
        .fetch_optional(pool)
        .await
        .map_err(|e| internal(e.to_string()))?
        .ok_or((StatusCode::UNAUTHORIZED, "invalid runner token".into()))
}

fn internal(msg: String) -> (StatusCode, String) {
    tracing::error!("cicd error: {msg}");
    (StatusCode::INTERNAL_SERVER_ERROR, msg)
}
