use std::collections::HashMap;
use std::path::{Path as FsPath, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use axum::{
    body::Body,
    extract::{DefaultBodyLimit, Multipart, Path, Query, State},
    http::{header, HeaderMap, StatusCode},
    response::Response,
    response::IntoResponse,
    routing::{delete, get, post, put},
    Json, Router,
};
use chrono::{DateTime, Utc};
use pertisk_cicd::{
    parse_pipeline_yaml, PipelineEvent, ScheduledJob, Scheduler, TriggerMatcher,
    CONFIG_PATHS,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::PgPool;
use tokio::process::Command;
use uuid::Uuid;

use crate::{
    artifacts::{self, ArtifactStore},
    ensure_can_write_repo, load_repo_for_read, ApiError, AppState, AuthUser,
};
use pertisk_domain::DomainError;

fn sqlx_error(err: sqlx::Error) -> ApiError {
    pertisk_domain::DomainError::Internal(err.to_string()).into()
}

/// No heartbeat for this long ⇒ runner is treated as offline (runner heartbeats every ~30s while busy).
const RUNNER_OFFLINE_AFTER_SECS: i64 = 180;
/// Running job with cancel_requested older than this is force-finalized (safety net).
const CANCEL_RECLAIM_AFTER_SECS: i64 = 30;
/// RPM/tar.gz CI artifacts exceed axum's default 2 MiB body limit.
const MAX_RUNNER_ARTIFACT_BYTES: usize = 256 * 1024 * 1024;

pub fn spawn_runner_stale_checker(pool: PgPool) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(30));
        loop {
            interval.tick().await;
            if let Err(err) = mark_stale_runners_offline(&pool).await {
                tracing::warn!(%err, "failed to mark stale runners offline");
            }
        }
    });
}

async fn mark_stale_runners_offline(pool: &PgPool) -> Result<(), sqlx::Error> {
    reclaim_stale_running_jobs(pool).await?;
    release_idle_runners(pool).await?;

    sqlx::query(
        r#"
        UPDATE runners r
        SET status = 'offline'
        WHERE r.status IN ('online', 'busy')
          AND (
            r.last_seen_at IS NULL
            OR r.last_seen_at < NOW() - make_interval(secs => $1)
          )
          AND NOT EXISTS (
            SELECT 1
            FROM job_runs j
            WHERE j.runner_id = r.id
              AND j.status = 'running'
          )
        "#,
    )
    .bind(RUNNER_OFFLINE_AFTER_SECS as f64)
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        DELETE FROM runner_instances
        WHERE last_seen_at < NOW() - make_interval(hours => 24)
        "#,
    )
    .execute(pool)
    .await?;

    Ok(())
}

/// Clear `busy` when no jobs are still running on the runner.
async fn release_idle_runners(pool: &PgPool) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        UPDATE runners r
        SET status = 'online'
        WHERE r.status = 'busy'
          AND NOT EXISTS (
            SELECT 1
            FROM job_runs j
            WHERE j.runner_id = r.id
              AND j.status = 'running'
          )
        "#,
    )
    .execute(pool)
    .await?;
    Ok(())
}

/// Running job exceeded `timeout_minutes` — reclaimed as failure.
async fn reclaim_timed_out_jobs(pool: &PgPool) -> Result<(), sqlx::Error> {
    let timed_out = sqlx::query_as::<_, (Uuid, Uuid, String, i32)>(
        r#"
        SELECT j.id, j.pipeline_run_id, j.job_name, j.timeout_minutes
        FROM job_runs j
        WHERE j.status = 'running'
          AND j.timeout_minutes IS NOT NULL
          AND j.started_at IS NOT NULL
          AND j.started_at + make_interval(mins => j.timeout_minutes) < NOW()
        "#,
    )
    .fetch_all(pool)
    .await?;

    for (job_id, pipeline_run_id, job_name, timeout_minutes) in timed_out {
        sqlx::query(
            r#"
            UPDATE job_runs
            SET status = 'failure',
                finished_at = NOW(),
                log_text = log_text || E'\n\n=== job timed out after ' || $2::text || ' minutes\n'
            WHERE id = $1 AND status = 'running'
            "#,
        )
        .bind(job_id)
        .bind(timeout_minutes)
        .execute(pool)
        .await?;

        if let Err(err) = update_commit_status_for_job(pool, job_id, "failure", &job_name).await {
            tracing::warn!(%job_id, %err, "failed to update commit status for timed-out job");
        }
        if let Err(err) = finalize_pipeline_run_if_done(pool, pipeline_run_id).await {
            tracing::warn!(%pipeline_run_id, %err, "failed to finalize pipeline after timed-out job");
        }
        tracing::warn!(%job_id, job = %job_name, timeout_minutes, "reclaimed job after timeout");
    }

    Ok(())
}

/// Fail jobs left in `running` when the runner stops heartbeating (crash/kill).
async fn reclaim_stale_running_jobs(pool: &PgPool) -> Result<(), sqlx::Error> {
    reclaim_timed_out_jobs(pool).await?;
    let stale_jobs = sqlx::query_as::<_, (Uuid, Uuid, String)>(
        r#"
        SELECT j.id, j.pipeline_run_id, j.job_name
        FROM job_runs j
        LEFT JOIN runners r ON r.id = j.runner_id
        WHERE j.status = 'running'
          AND (
            j.runner_id IS NULL
            OR r.last_seen_at IS NULL
            OR r.last_seen_at < NOW() - make_interval(secs => $1)
          )
        "#,
    )
    .bind(RUNNER_OFFLINE_AFTER_SECS as f64)
    .fetch_all(pool)
    .await?;

    for (job_id, pipeline_run_id, job_name) in stale_jobs {
        sqlx::query(
            r#"
            UPDATE job_runs
            SET status = 'failure',
                finished_at = NOW(),
                log_text = log_text || E'\n\n=== job failed (runner lost contact)\n'
            WHERE id = $1 AND status = 'running'
            "#,
        )
        .bind(job_id)
        .execute(pool)
        .await?;

        if let Err(err) = update_commit_status_for_job(pool, job_id, "failure", &job_name).await {
            tracing::warn!(%job_id, %err, "failed to update commit status for reclaimed job");
        }
        if let Err(err) = finalize_pipeline_run_if_done(pool, pipeline_run_id).await {
            tracing::warn!(%pipeline_run_id, %err, "failed to finalize pipeline after reclaimed job");
        }
        tracing::warn!(%job_id, job = %job_name, "reclaimed stale running job");
    }

    let cancel_stale = sqlx::query_as::<_, (Uuid, Uuid, String)>(
        r#"
        SELECT j.id, j.pipeline_run_id, j.job_name
        FROM job_runs j
        WHERE j.status = 'running'
          AND j.cancel_requested_at IS NOT NULL
          AND j.cancel_requested_at < NOW() - make_interval(secs => $1)
        "#,
    )
    .bind(CANCEL_RECLAIM_AFTER_SECS as f64)
    .fetch_all(pool)
    .await?;

    for (job_id, pipeline_run_id, job_name) in cancel_stale {
        sqlx::query(
            r#"
            UPDATE job_runs
            SET status = 'cancelled'::job_run_status,
                finished_at = NOW(),
                log_text = log_text || E'\n\n=== job cancelled (runner did not finish in time)\n'
            WHERE id = $1 AND status = 'running'
            "#,
        )
        .bind(job_id)
        .execute(pool)
        .await?;

        if let Err(err) = update_commit_status_for_job(pool, job_id, "cancelled", &job_name).await {
            tracing::warn!(%job_id, %err, "failed to update commit status for cancel-reclaimed job");
        }
        if let Err(err) = finalize_pipeline_run_if_done(pool, pipeline_run_id).await {
            tracing::warn!(%pipeline_run_id, %err, "failed to finalize pipeline after cancel-reclaimed job");
        }
        tracing::warn!(%job_id, job = %job_name, "reclaimed running job after cancel timeout");
    }

    Ok(())
}

pub fn cicd_read_routes() -> Router<AppState> {
    Router::new()
        .route(
            "/organizations/{org_slug}/repositories/{repo_slug}/pipelines",
            get(list_pipeline_runs),
        )
        .route(
            "/organizations/{org_slug}/repositories/{repo_slug}/pipelines/config",
            get(get_pipeline_config_preview),
        )
        .route(
            "/organizations/{org_slug}/repositories/{repo_slug}/pipelines/{run_id}",
            get(get_pipeline_run),
        )
        .route(
            "/organizations/{org_slug}/repositories/{repo_slug}/pipelines/{run_id}/artifacts/{artifact_id}/download",
            get(download_pipeline_artifact),
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
        .route(
            "/organizations/{org_slug}/repositories/{repo_slug}/pipelines/{run_id}/rerun",
            post(rerun_pipeline),
        )
        .route(
            "/organizations/{org_slug}/repositories/{repo_slug}/pipelines/{run_id}/cancel",
            post(cancel_pipeline),
        )
        .route(
            "/organizations/{org_slug}/repositories/{repo_slug}/pipelines/{run_id}",
            delete(delete_pipeline),
        )
        .route(
            "/organizations/{org_slug}/repositories/{repo_slug}/pipelines/{run_id}/jobs/{job_id}/cancel-step",
            post(cancel_job_step),
        )
        .route("/runners/register", post(register_runner))
        .route("/runners/{runner_id}", delete(delete_runner))
        .route("/runners/{runner_id}/rotate-token", post(rotate_runner_token))
}

pub fn runner_routes() -> Router<AppState> {
    Router::new()
        .route("/runner/jobs", get(poll_runner_job))
        .route("/runner/jobs/{job_id}/start", post(start_runner_job))
        .route("/runner/jobs/{job_id}/log", post(append_runner_job_log))
        .route("/runner/jobs/{job_id}/complete", post(complete_runner_job))
        .route("/runner/jobs/{job_id}/artifacts", post(upload_runner_artifact))
        .route("/runner/heartbeat", post(runner_heartbeat))
        .route(
            "/runner/repos/{org_slug}/{repo_slug}/workspace",
            get(runner_workspace),
        )
        .route("/runner/jobs/{job_id}/workspace", get(runner_job_workspace))
        .route("/runner/jobs/{job_id}/control", get(runner_job_control))
        .route("/runner/jobs/{job_id}/secrets", get(runner_job_secrets))
        .route("/runner/jobs/{job_id}/k8s-pod", put(upsert_runner_k8s_pod))
        .layer(DefaultBodyLimit::max(MAX_RUNNER_ARTIFACT_BYTES))
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
    needs: Vec<String>,
    steps: Vec<JobStepResponse>,
    artifacts: Vec<JobArtifactResponse>,
    metrics_json: Option<Value>,
    log_text: String,
    queued_at: DateTime<Utc>,
    started_at: Option<DateTime<Utc>>,
    finished_at: Option<DateTime<Utc>>,
}

#[derive(Serialize)]
struct JobArtifactResponse {
    id: Uuid,
    job_run_id: Uuid,
    name: String,
    path: String,
    size_bytes: i64,
    created_at: DateTime<Utc>,
}

#[derive(Serialize)]
struct JobStepResponse {
    name: String,
    run: String,
}

#[derive(Deserialize)]
struct PipelineConfigQuery {
    r#ref: Option<String>,
}

#[derive(Serialize)]
struct PipelineConfigPreviewResponse {
    config_path: String,
    commit_sha: String,
    r#ref: String,
    jobs: Vec<PipelineJobPreview>,
}

#[derive(Serialize)]
struct PipelineJobPreview {
    name: String,
    runs_on: String,
    needs: Vec<String>,
    step_count: usize,
    steps: Vec<JobStepResponse>,
}

#[derive(Serialize)]
struct CommitStatusResponse {
    context: String,
    state: String,
    description: Option<String>,
    target_url: Option<String>,
    required: bool,
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
    api_url: String,
}

#[derive(Serialize)]
struct RunnerInstanceResponse {
    instance_id: String,
    host_ip: Option<String>,
    version: Option<String>,
    cpu_cores: Option<i32>,
    memory_total_mb: Option<i64>,
    memory_used_mb: Option<i64>,
    status: &'static str,
    last_seen_at: DateTime<Utc>,
}

#[derive(Serialize)]
struct RunnerK8sPodResponse {
    job_run_id: Uuid,
    job_name: String,
    k8s_namespace: String,
    k8s_job_name: String,
    k8s_pod_name: Option<String>,
    phase: String,
    created_at: DateTime<Utc>,
}

#[derive(Serialize)]
struct RunnerResponse {
    id: Uuid,
    name: String,
    labels: Vec<String>,
    status: String,
    version: Option<String>,
    host_ip: Option<String>,
    host_name: Option<String>,
    cpu_cores: Option<i32>,
    memory_total_mb: Option<i64>,
    memory_used_mb: Option<i64>,
    disk_total_mb: Option<i64>,
    disk_free_mb: Option<i64>,
    last_job_name: Option<String>,
    last_job_status: Option<String>,
    last_job_at: Option<DateTime<Utc>>,
    current_job_name: Option<String>,
    last_seen_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
    instances: Vec<RunnerInstanceResponse>,
    k8s_pods: Vec<RunnerK8sPodResponse>,
}

#[derive(Serialize)]
struct RotateRunnerTokenResponse {
    token: String,
    api_url: String,
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
    artifacts: Value,
    timeout_minutes: Option<i32>,
}

#[derive(Deserialize)]
struct CompleteJobRequest {
    status: String,
    log_text: Option<String>,
    metrics_json: Option<Value>,
}

#[derive(Deserialize)]
struct AppendLogRequest {
    append: String,
}

async fn get_pipeline_config_preview(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_slug, repo_slug)): Path<(String, String)>,
    Query(query): Query<PipelineConfigQuery>,
) -> Result<Json<PipelineConfigPreviewResponse>, ApiError> {
    let (_org, repo, repo_path) =
        load_repo_for_read(&state, &org_slug, &repo_slug, Some(&auth)).await?;

    let ref_name = query
        .r#ref
        .filter(|r| !r.trim().is_empty())
        .unwrap_or_else(|| repo.default_branch.clone());
    let commit_sha = resolve_git_ref(&repo_path, &ref_name).await?;
    let normalized_ref = if ref_name.starts_with("refs/") {
        ref_name
    } else {
        format!("refs/heads/{ref_name}")
    };

    let Some((config_yaml, config_path)) = read_pipeline_config(&repo_path, &commit_sha).await else {
        return Err(DomainError::NotFound.into());
    };

    let config = parse_pipeline_yaml(&config_yaml).map_err(|e| {
        ApiError::from(DomainError::Validation(format!("invalid pipeline config: {e}")))
    })?;

    let mut jobs: Vec<PipelineJobPreview> = config
        .jobs
        .into_iter()
        .map(|(name, job)| PipelineJobPreview {
            name,
            runs_on: job.runs_on,
            needs: job.needs.clone(),
            step_count: job.steps.len(),
            steps: job
                .steps
                .iter()
                .enumerate()
                .map(|(index, step)| JobStepResponse {
                    name: step
                        .name
                        .clone()
                        .or_else(|| step.uses.clone())
                        .unwrap_or_else(|| format!("step-{}", index + 1)),
                    run: if step.run.trim().is_empty() {
                        step.uses.clone().unwrap_or_default()
                    } else {
                        step.run.clone()
                    },
                })
                .collect(),
        })
        .collect();
    jobs.sort_by(|a, b| a.name.cmp(&b.name));

    Ok(Json(PipelineConfigPreviewResponse {
        config_path,
        commit_sha,
        r#ref: normalized_ref,
        jobs,
    }))
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

    sync_pipeline_run_state(&state.pool, run_id)
        .await
        .map_err(sqlx_error)?;

    let run = fetch_pipeline_run(&state.pool, repo.id, run_id)
        .await
        .map_err(sqlx_error)?
        .ok_or(pertisk_domain::DomainError::NotFound)?;
    let jobs = fetch_job_runs(&state.pool, run.id).await.map_err(sqlx_error)?;
    Ok(Json(run.into_response(jobs)))
}

async fn delete_pipeline(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_slug, repo_slug, run_id)): Path<(String, String, Uuid)>,
) -> Result<StatusCode, ApiError> {
    let (_org, repo, _path) = load_repo_for_read(&state, &org_slug, &repo_slug, Some(&auth)).await?;
    ensure_can_write_repo(&state, &org_slug, &repo, &auth).await?;

    ensure_pipeline_idle(&state.pool, repo.id, run_id).await?;

    delete_pipeline_artifact_files(&state.pool, &state.artifacts, run_id)
        .await
        .map_err(sqlx_error)?;

    let deleted = sqlx::query("DELETE FROM pipeline_runs WHERE id = $1 AND repository_id = $2")
        .bind(run_id)
        .bind(repo.id)
        .execute(&state.pool)
        .await
        .map_err(sqlx_error)?;

    if deleted.rows_affected() == 0 {
        return Err(DomainError::NotFound.into());
    }

    Ok(StatusCode::NO_CONTENT)
}

async fn list_commit_statuses(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_slug, repo_slug, commit_sha)): Path<(String, String, String)>,
) -> Result<Json<Vec<CommitStatusResponse>>, ApiError> {
    let (_org, repo, _path) = load_repo_for_read(&state, &org_slug, &repo_slug, Some(&auth)).await?;

    let rows = sqlx::query_as::<_, CommitStatusRow>(
        r#"
        SELECT context, state::text, description, target_url, required, updated_at
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
                required: row.required,
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MaterializeMode {
    Fresh,
    RerunAll,
    RerunFailed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
enum RerunScope {
    #[default]
    All,
    Failed,
}

#[derive(Deserialize, Default)]
struct RerunPipelineRequest {
    #[serde(default)]
    scope: RerunScope,
}

async fn rerun_pipeline(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_slug, repo_slug, run_id)): Path<(String, String, Uuid)>,
    body: Option<Json<RerunPipelineRequest>>,
) -> Result<Json<PipelineRunResponse>, ApiError> {
    let (_org, repo, _path) = load_repo_for_read(&state, &org_slug, &repo_slug, Some(&auth)).await?;
    ensure_can_write_repo(&state, &org_slug, &repo, &auth).await?;

    let run = fetch_pipeline_run(&state.pool, repo.id, run_id)
        .await
        .map_err(sqlx_error)?
        .ok_or(DomainError::NotFound)?;

    ensure_pipeline_idle(&state.pool, repo.id, run_id).await?;

    let repo_path = pertisk_git::config::repo_disk_path(&state.config.repos_root, &org_slug, &repo_slug);
    let Some((config_yaml, config_path)) = read_pipeline_config(&repo_path, &run.commit_sha).await else {
        return Err(DomainError::Validation(
            "no pipeline config (.pertisk-ci.yaml) at this commit".into(),
        )
        .into());
    };

    let config = parse_pipeline_yaml(&config_yaml).map_err(|e| {
        DomainError::Validation(format!("invalid pipeline config: {e}"))
    })?;

    let jobs = Scheduler::schedule(&config).map_err(|e| {
        DomainError::Validation(format!("schedule failed: {e}"))
    })?;

    let scope = body.map(|Json(b)| b.scope).unwrap_or_default();
    let mode = match scope {
        RerunScope::All => MaterializeMode::RerunAll,
        RerunScope::Failed => {
            let statuses = fetch_job_status_map(&state.pool, run_id)
                .await
                .map_err(sqlx_error)?;
            let has_failed = statuses
                .values()
                .any(|status| status == "failure" || status == "cancelled");
            if !has_failed {
                return Err(
                    DomainError::Validation("no failed or cancelled jobs to rerun".into()).into(),
                );
            }
            MaterializeMode::RerunFailed
        }
    };

    reset_pipeline_run(
        &state.pool,
        &state.artifacts,
        repo.id,
        run_id,
        &run.commit_sha,
        &config_path,
        &jobs,
        mode,
    )
    .await
    .map_err(sqlx_error)?;

    let run = fetch_pipeline_run(&state.pool, repo.id, run_id)
        .await
        .map_err(sqlx_error)?
        .ok_or(DomainError::NotFound)?;
    let job_rows = fetch_job_runs(&state.pool, run.id).await.map_err(sqlx_error)?;
    Ok(Json(run.into_response(job_rows)))
}

async fn cancel_pipeline(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_slug, repo_slug, run_id)): Path<(String, String, Uuid)>,
) -> Result<Json<PipelineRunResponse>, ApiError> {
    let (_org, repo, _path) = load_repo_for_read(&state, &org_slug, &repo_slug, Some(&auth)).await?;
    ensure_can_write_repo(&state, &org_slug, &repo, &auth).await?;

    cancel_pipeline_run(&state.pool, repo.id, run_id)
        .await
        .map_err(|e| -> ApiError {
            match e {
                CancelError::NotFound => DomainError::NotFound.into(),
                CancelError::NotCancellable => {
                    DomainError::Validation("pipeline is not running".into()).into()
                }
            }
        })?;

    sync_pipeline_run_state(&state.pool, run_id)
        .await
        .map_err(sqlx_error)?;

    let run = fetch_pipeline_run(&state.pool, repo.id, run_id)
        .await
        .map_err(sqlx_error)?
        .ok_or(DomainError::NotFound)?;
    let jobs = fetch_job_runs(&state.pool, run.id).await.map_err(sqlx_error)?;
    Ok(Json(run.into_response(jobs)))
}

#[derive(Deserialize, Default)]
struct CancelJobStepRequest {
    step_name: Option<String>,
}

async fn cancel_job_step(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_slug, repo_slug, run_id, job_id)): Path<(String, String, Uuid, Uuid)>,
    Json(body): Json<CancelJobStepRequest>,
) -> Result<Json<PipelineRunResponse>, ApiError> {
    let (_org, repo, _path) = load_repo_for_read(&state, &org_slug, &repo_slug, Some(&auth)).await?;
    ensure_can_write_repo(&state, &org_slug, &repo, &auth).await?;

    cancel_job_step_run(&state.pool, repo.id, run_id, job_id, body.step_name.as_deref())
        .await
        .map_err(|e| -> ApiError {
            match e {
                CancelError::NotFound => DomainError::NotFound.into(),
                CancelError::NotCancellable => DomainError::Validation(
                    "job is not running or step cannot be cancelled".into(),
                )
                .into(),
            }
        })?;

    let run = fetch_pipeline_run(&state.pool, repo.id, run_id)
        .await
        .map_err(sqlx_error)?
        .ok_or(DomainError::NotFound)?;
    let jobs = fetch_job_runs(&state.pool, run.id).await.map_err(sqlx_error)?;
    Ok(Json(run.into_response(jobs)))
}

async fn list_runners(
    State(state): State<AppState>,
    _auth: AuthUser,
) -> Result<Json<Vec<RunnerResponse>>, ApiError> {
    mark_stale_runners_offline(&state.pool)
        .await
        .map_err(sqlx_error)?;

    let rows = sqlx::query_as::<_, RunnerRow>(
        r#"
        SELECT
            r.id, r.name, r.labels, r.status::text, r.version, r.host_ip, r.host_name,
            r.cpu_cores, r.memory_total_mb, r.memory_used_mb, r.disk_total_mb, r.disk_free_mb,
            r.last_job_name, r.last_job_status, r.last_job_at, r.last_seen_at, r.created_at,
            (
                SELECT j.job_name
                FROM job_runs j
                WHERE j.runner_id = r.id AND j.status = 'running'
                ORDER BY j.started_at DESC NULLS LAST
                LIMIT 1
            ) AS current_job_name
        FROM runners r
        ORDER BY r.created_at DESC
        "#,
    )
    .fetch_all(&state.pool)
    .await
    .map_err(sqlx_error)?;

    let runner_ids: Vec<Uuid> = rows.iter().map(|row| row.id).collect();
    let mut instances_by_runner: HashMap<Uuid, Vec<RunnerInstanceResponse>> = HashMap::new();
    let mut k8s_pods_by_runner: HashMap<Uuid, Vec<RunnerK8sPodResponse>> = HashMap::new();

    if !runner_ids.is_empty() {
        let instance_rows = sqlx::query_as::<_, RunnerInstanceRow>(
            r#"
            SELECT runner_id, instance_id, host_ip, version, cpu_cores, memory_total_mb, memory_used_mb, last_seen_at
            FROM runner_instances
            WHERE runner_id = ANY($1)
            ORDER BY last_seen_at DESC
            "#,
        )
        .bind(&runner_ids)
        .fetch_all(&state.pool)
        .await
        .map_err(sqlx_error)?;

        for row in instance_rows {
            instances_by_runner
                .entry(row.runner_id)
                .or_default()
                .push(RunnerInstanceResponse {
                    instance_id: row.instance_id,
                    host_ip: row.host_ip,
                    version: row.version,
                    cpu_cores: row.cpu_cores,
                    memory_total_mb: row.memory_total_mb,
                    memory_used_mb: row.memory_used_mb,
                    status: instance_status(row.last_seen_at),
                    last_seen_at: row.last_seen_at,
                });
        }

        let k8s_rows = sqlx::query_as::<_, RunnerK8sPodRow>(
            r#"
            SELECT
                rkp.runner_id,
                rkp.job_run_id,
                j.job_name,
                rkp.k8s_namespace,
                rkp.k8s_job_name,
                rkp.k8s_pod_name,
                rkp.phase,
                rkp.created_at
            FROM runner_k8s_pods rkp
            JOIN job_runs j ON j.id = rkp.job_run_id
            WHERE rkp.runner_id = ANY($1)
              AND rkp.finished_at IS NULL
            ORDER BY rkp.created_at DESC
            "#,
        )
        .bind(&runner_ids)
        .fetch_all(&state.pool)
        .await
        .map_err(sqlx_error)?;

        for row in k8s_rows {
            k8s_pods_by_runner
                .entry(row.runner_id)
                .or_default()
                .push(RunnerK8sPodResponse {
                    job_run_id: row.job_run_id,
                    job_name: row.job_name,
                    k8s_namespace: row.k8s_namespace,
                    k8s_job_name: row.k8s_job_name,
                    k8s_pod_name: row.k8s_pod_name,
                    phase: row.phase,
                    created_at: row.created_at,
                });
        }
    }

    Ok(Json(
        rows.into_iter()
            .map(|row| {
                let id = row.id;
                RunnerResponse {
                    id,
                    name: row.name,
                    labels: row.labels,
                    status: row.status,
                    version: row.version,
                    host_ip: row.host_ip,
                    host_name: row.host_name,
                    cpu_cores: row.cpu_cores,
                    memory_total_mb: row.memory_total_mb,
                    memory_used_mb: row.memory_used_mb,
                    disk_total_mb: row.disk_total_mb,
                    disk_free_mb: row.disk_free_mb,
                    last_job_name: row.last_job_name,
                    last_job_status: row.last_job_status,
                    last_job_at: row.last_job_at,
                    current_job_name: row.current_job_name,
                    last_seen_at: row.last_seen_at,
                    created_at: row.created_at,
                    instances: instances_by_runner.remove(&id).unwrap_or_default(),
                    k8s_pods: k8s_pods_by_runner.remove(&id).unwrap_or_default(),
                }
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

    let mut labels: Vec<String> = body
        .labels
        .unwrap_or_default()
        .into_iter()
        .map(|label| label.trim().to_string())
        .filter(|label| !label.is_empty())
        .collect();
    labels.sort();
    labels.dedup();
    if labels.is_empty() {
        return Err(
            pertisk_domain::DomainError::Validation("at least one runner label is required".into())
                .into(),
        );
    }
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

    Ok(Json(RegisterRunnerResponse {
        runner_id,
        token,
        api_url: state.config.git_public_base_url.clone(),
    }))
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

    Ok(Json(RotateRunnerTokenResponse {
        token,
        api_url: state.config.git_public_base_url.clone(),
    }))
}

async fn poll_runner_job(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<PollQuery>,
) -> Result<Json<Option<PollJobResponse>>, (StatusCode, String)> {
    let runner_id = authenticate_runner(&state.pool, &headers).await?;
    if let Err(err) = mark_stale_runners_offline(&state.pool).await {
        tracing::warn!(%err, "failed to mark stale runners offline during poll");
    }
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
                    j.artifacts_json,
                    j.timeout_minutes,
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
                artifacts: meta.artifacts_json,
                timeout_minutes: meta.timeout_minutes,
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

async fn append_runner_job_log(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(job_id): Path<Uuid>,
    Json(body): Json<AppendLogRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    if body.append.is_empty() {
        return Ok(StatusCode::NO_CONTENT);
    }

    let runner_id = authenticate_runner(&state.pool, &headers).await?;
    let updated = sqlx::query(
        r#"
        UPDATE job_runs
        SET log_text = log_text || $3
        WHERE id = $1 AND runner_id = $2 AND status IN ('queued', 'running')
        "#,
    )
    .bind(job_id)
    .bind(runner_id)
    .bind(&body.append)
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

    sqlx::query(
        r#"
        UPDATE runners
        SET status = CASE
                WHEN EXISTS (
                    SELECT 1
                    FROM job_runs j
                    WHERE j.runner_id = $1
                      AND j.status = 'running'
                ) THEN 'busy'::runner_status
                ELSE 'online'::runner_status
            END,
            last_seen_at = NOW(),
            last_job_name = $2,
            last_job_status = $3,
            last_job_at = NOW()
        WHERE id = $1
        "#,
    )
    .bind(runner_id)
    .bind(&job_name)
    .bind(status)
    .execute(&state.pool)
    .await
    .map_err(|e| internal(e.to_string()))?;

    sqlx::query(
        r#"
        UPDATE runner_k8s_pods
        SET phase = $2,
            finished_at = COALESCE(finished_at, NOW())
        WHERE job_run_id = $1
        "#,
    )
    .bind(job_id)
    .bind(k8s_pod_phase_for_status(status))
    .execute(&state.pool)
    .await
    .map_err(|e| internal(e.to_string()))?;

    Ok(StatusCode::NO_CONTENT)
}

async fn runner_heartbeat(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Option<Json<RunnerHeartbeatRequest>>,
) -> Result<StatusCode, (StatusCode, String)> {
    let runner_id = authenticate_runner(&state.pool, &headers).await?;
    let body = body.map(|Json(b)| b).unwrap_or_default();
    let host_ip = request_client_ip(&headers).or(body.host_ip.clone());
    let instance_id = body
        .host_name
        .as_deref()
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(str::to_string);

    sqlx::query(
        r#"
        UPDATE runners
        SET status = CASE
                WHEN EXISTS (
                    SELECT 1
                    FROM job_runs j
                    WHERE j.runner_id = $1
                      AND j.status = 'running'
                ) THEN 'busy'::runner_status
                ELSE 'online'::runner_status
            END,
            last_seen_at = NOW(),
            version = COALESCE($2, version),
            host_ip = COALESCE($3, host_ip),
            host_name = COALESCE($4, host_name),
            cpu_cores = COALESCE($5, cpu_cores),
            memory_total_mb = COALESCE($6, memory_total_mb),
            memory_used_mb = COALESCE($7, memory_used_mb),
            disk_total_mb = COALESCE($8, disk_total_mb),
            disk_free_mb = COALESCE($9, disk_free_mb)
        WHERE id = $1
        "#,
    )
    .bind(runner_id)
    .bind(&body.version)
    .bind(&host_ip)
    .bind(&body.host_name)
    .bind(body.cpu_cores)
    .bind(body.memory_total_mb)
    .bind(body.memory_used_mb)
    .bind(body.disk_total_mb)
    .bind(body.disk_free_mb)
    .execute(&state.pool)
    .await
    .map_err(|e| internal(e.to_string()))?;

    if let Some(instance_id) = instance_id {
        sqlx::query(
            r#"
            INSERT INTO runner_instances (
                runner_id, instance_id, host_ip, version, cpu_cores,
                memory_total_mb, memory_used_mb, disk_total_mb, disk_free_mb, last_seen_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
            ON CONFLICT (runner_id, instance_id) DO UPDATE SET
                host_ip = COALESCE(EXCLUDED.host_ip, runner_instances.host_ip),
                version = COALESCE(EXCLUDED.version, runner_instances.version),
                cpu_cores = COALESCE(EXCLUDED.cpu_cores, runner_instances.cpu_cores),
                memory_total_mb = COALESCE(EXCLUDED.memory_total_mb, runner_instances.memory_total_mb),
                memory_used_mb = COALESCE(EXCLUDED.memory_used_mb, runner_instances.memory_used_mb),
                disk_total_mb = COALESCE(EXCLUDED.disk_total_mb, runner_instances.disk_total_mb),
                disk_free_mb = COALESCE(EXCLUDED.disk_free_mb, runner_instances.disk_free_mb),
                last_seen_at = NOW()
            "#,
        )
        .bind(runner_id)
        .bind(&instance_id)
        .bind(&host_ip)
        .bind(&body.version)
        .bind(body.cpu_cores)
        .bind(body.memory_total_mb)
        .bind(body.memory_used_mb)
        .bind(body.disk_total_mb)
        .bind(body.disk_free_mb)
        .execute(&state.pool)
        .await
        .map_err(|e| internal(e.to_string()))?;
    }

    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct UpsertK8sPodRequest {
    k8s_namespace: String,
    k8s_job_name: String,
    k8s_pod_name: Option<String>,
    phase: String,
    #[serde(default)]
    finished: bool,
}

async fn upsert_runner_k8s_pod(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(job_id): Path<Uuid>,
    Json(body): Json<UpsertK8sPodRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    let runner_id = authenticate_runner(&state.pool, &headers).await?;

    let owned = sqlx::query_scalar::<_, bool>(
        r#"
        SELECT EXISTS(
            SELECT 1 FROM job_runs WHERE id = $1 AND runner_id = $2
        )
        "#,
    )
    .bind(job_id)
    .bind(runner_id)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| internal(e.to_string()))?;

    if !owned {
        return Err((StatusCode::NOT_FOUND, "job not found".into()));
    }

    sqlx::query(
        r#"
        INSERT INTO runner_k8s_pods (
            job_run_id, runner_id, k8s_namespace, k8s_job_name, k8s_pod_name, phase, finished_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $7 THEN NOW() ELSE NULL END)
        ON CONFLICT (job_run_id) DO UPDATE SET
            k8s_pod_name = COALESCE(EXCLUDED.k8s_pod_name, runner_k8s_pods.k8s_pod_name),
            phase = EXCLUDED.phase,
            finished_at = CASE
                WHEN $7 THEN COALESCE(runner_k8s_pods.finished_at, NOW())
                ELSE runner_k8s_pods.finished_at
            END
        "#,
    )
    .bind(job_id)
    .bind(runner_id)
    .bind(body.k8s_namespace.trim())
    .bind(body.k8s_job_name.trim())
    .bind(body.k8s_pod_name)
    .bind(body.phase.trim())
    .bind(body.finished)
    .execute(&state.pool)
    .await
    .map_err(|e| internal(e.to_string()))?;

    Ok(StatusCode::NO_CONTENT)
}

fn instance_status(last_seen_at: DateTime<Utc>) -> &'static str {
    let age_secs = (Utc::now() - last_seen_at).num_seconds();
    if age_secs <= RUNNER_OFFLINE_AFTER_SECS {
        "online"
    } else {
        "offline"
    }
}

fn k8s_pod_phase_for_status(status: &str) -> &'static str {
    match status {
        "success" => "succeeded",
        "cancelled" => "cancelled",
        _ => "failed",
    }
}

#[derive(Debug, Default, Deserialize)]
struct RunnerHeartbeatRequest {
    version: Option<String>,
    host_name: Option<String>,
    host_ip: Option<String>,
    cpu_cores: Option<i32>,
    memory_total_mb: Option<i64>,
    memory_used_mb: Option<i64>,
    disk_total_mb: Option<i64>,
    disk_free_mb: Option<i64>,
}

fn request_client_ip(headers: &HeaderMap) -> Option<String> {
    headers
        .get("x-forwarded-for")
        .or_else(|| headers.get("x-real-ip"))
        .and_then(|value| value.to_str().ok())
        .map(|value| value.split(',').next().unwrap_or(value).trim().to_string())
        .filter(|ip| !ip.is_empty())
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

/// Block merge when required CI checks exist and any are pending or failed.
pub async fn ensure_ci_passed_for_commit(
    pool: &PgPool,
    repository_id: Uuid,
    commit_sha: &str,
) -> Result<(), pertisk_domain::DomainError> {
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

    materialize_jobs_for_run(
        &state.pool,
        &state.artifacts,
        repository_id,
        commit_sha,
        run_id,
        &jobs,
        MaterializeMode::Fresh,
    )
    .await?;

    Ok(run_id)
}

async fn reset_pipeline_run(
    pool: &PgPool,
    store: &ArtifactStore,
    repository_id: Uuid,
    run_id: Uuid,
    commit_sha: &str,
    config_path: &str,
    jobs: &[ScheduledJob],
    mode: MaterializeMode,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        UPDATE pipeline_runs
        SET status = 'queued', config_path = $3, started_at = NOW(), finished_at = NULL
        WHERE id = $1 AND repository_id = $2
        "#,
    )
    .bind(run_id)
    .bind(repository_id)
    .bind(config_path)
    .execute(pool)
    .await?;

    materialize_jobs_for_run(pool, store, repository_id, commit_sha, run_id, jobs, mode).await
}

async fn fetch_job_status_map(
    pool: &PgPool,
    run_id: Uuid,
) -> Result<std::collections::HashMap<String, String>, sqlx::Error> {
    let rows = sqlx::query_as::<_, (String, String)>(
        r#"
        SELECT job_name, status::text
        FROM job_runs
        WHERE pipeline_run_id = $1
        "#,
    )
    .bind(run_id)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().collect())
}

fn job_should_reset(mode: MaterializeMode, existing_status: Option<&str>) -> bool {
    match mode {
        MaterializeMode::Fresh | MaterializeMode::RerunAll => true,
        MaterializeMode::RerunFailed => match existing_status {
            None => true,
            Some("success") => false,
            Some(_) => true,
        },
    }
}

async fn delete_pipeline_artifact_files(
    pool: &PgPool,
    store: &ArtifactStore,
    run_id: Uuid,
) -> Result<(), sqlx::Error> {
    let keys = sqlx::query_scalar::<_, String>(
        r#"
        SELECT a.storage_key
        FROM job_artifacts a
        INNER JOIN job_runs j ON j.id = a.job_run_id
        WHERE j.pipeline_run_id = $1
        "#,
    )
    .bind(run_id)
    .fetch_all(pool)
    .await?;

    store.delete_keys(&keys).await;
    Ok(())
}

async fn delete_artifact_files_for_job_names(
    pool: &PgPool,
    store: &ArtifactStore,
    run_id: Uuid,
    job_names: &[String],
) -> Result<(), sqlx::Error> {
    if job_names.is_empty() {
        return Ok(());
    }

    let keys = sqlx::query_scalar::<_, String>(
        r#"
        SELECT a.storage_key
        FROM job_artifacts a
        INNER JOIN job_runs j ON j.id = a.job_run_id
        WHERE j.pipeline_run_id = $1 AND j.job_name = ANY($2)
        "#,
    )
    .bind(run_id)
    .bind(job_names)
    .fetch_all(pool)
    .await?;

    store.delete_keys(&keys).await;

    sqlx::query(
        r#"
        DELETE FROM job_artifacts
        WHERE job_run_id IN (
            SELECT id FROM job_runs WHERE pipeline_run_id = $1 AND job_name = ANY($2)
        )
        "#,
    )
    .bind(run_id)
    .bind(job_names)
    .execute(pool)
    .await?;

    Ok(())
}

async fn materialize_jobs_for_run(
    pool: &PgPool,
    store: &ArtifactStore,
    repository_id: Uuid,
    commit_sha: &str,
    run_id: Uuid,
    jobs: &[ScheduledJob],
    mode: MaterializeMode,
) -> Result<(), sqlx::Error> {
    let job_names: Vec<String> = jobs.iter().map(|job| job.name.clone()).collect();
    let existing_statuses = fetch_job_status_map(pool, run_id).await?;
    let mut reset_job_names: Vec<String> = Vec::new();

    for job in jobs {
        let should_reset = job_should_reset(mode, existing_statuses.get(&job.name).map(String::as_str));
        if !should_reset {
            continue;
        }
        reset_job_names.push(job.name.clone());

        let steps_json = serde_json::to_value(&job.job.steps).unwrap_or(Value::Array(vec![]));
        let artifacts_json =
            serde_json::to_value(&job.job.artifacts).unwrap_or(Value::Array(vec![]));
        sqlx::query(
            r#"
            INSERT INTO job_runs (pipeline_run_id, job_name, runs_on, steps_json, artifacts_json, needs, timeout_minutes, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, 'queued')
            ON CONFLICT (pipeline_run_id, job_name)
            DO UPDATE SET
                runs_on = EXCLUDED.runs_on,
                steps_json = EXCLUDED.steps_json,
                artifacts_json = EXCLUDED.artifacts_json,
                needs = EXCLUDED.needs,
                timeout_minutes = EXCLUDED.timeout_minutes,
                status = 'queued',
                runner_id = NULL,
                metrics_json = NULL,
                log_text = '',
                queued_at = NOW(),
                started_at = NULL,
                finished_at = NULL
            "#,
        )
        .bind(run_id)
        .bind(&job.name)
        .bind(&job.job.runs_on)
        .bind(steps_json)
        .bind(artifacts_json)
        .bind(&job.job.needs)
        .bind(job.job.timeout_minutes.map(|m| m as i32))
        .execute(pool)
        .await?;

        sqlx::query(
            r#"
            INSERT INTO commit_statuses (repository_id, commit_sha, context, state, description, pipeline_run_id, required)
            VALUES ($1, $2, $3, 'pending', 'Queued', $4, $5)
            ON CONFLICT (repository_id, commit_sha, context)
            DO UPDATE SET
                state = 'pending',
                description = 'Queued',
                updated_at = NOW(),
                pipeline_run_id = EXCLUDED.pipeline_run_id,
                required = EXCLUDED.required
            "#,
        )
        .bind(repository_id)
        .bind(commit_sha)
        .bind(format!("ci/{}", job.name))
        .bind(run_id)
        .bind(job.job.required)
        .execute(pool)
        .await?;
    }

    if job_names.is_empty() {
        delete_pipeline_artifact_files(pool, store, run_id).await?;
        sqlx::query("DELETE FROM job_runs WHERE pipeline_run_id = $1")
            .bind(run_id)
            .execute(pool)
            .await?;
    } else {
        match mode {
            MaterializeMode::RerunFailed => {
                delete_artifact_files_for_job_names(pool, store, run_id, &reset_job_names).await?;
            }
            MaterializeMode::Fresh | MaterializeMode::RerunAll => {
                delete_pipeline_artifact_files(pool, store, run_id).await?;
                sqlx::query(
                    r#"
                    DELETE FROM job_artifacts
                    WHERE job_run_id IN (SELECT id FROM job_runs WHERE pipeline_run_id = $1)
                    "#,
                )
                .bind(run_id)
                .execute(pool)
                .await?;
            }
        }

        sqlx::query(
            r#"
            DELETE FROM job_runs
            WHERE pipeline_run_id = $1 AND NOT (job_name = ANY($2))
            "#,
        )
        .bind(run_id)
        .bind(&job_names)
        .execute(pool)
        .await?;
    }

    sqlx::query("UPDATE pipeline_runs SET status = 'running' WHERE id = $1")
        .bind(run_id)
        .execute(pool)
        .await?;

    Ok(())
}

async fn resolve_git_ref(repo_path: &FsPath, ref_name: &str) -> Result<String, ApiError> {
    let normalized = if ref_name.starts_with("refs/") {
        ref_name.to_string()
    } else {
        format!("refs/heads/{ref_name}")
    };

    let output = Command::new("git")
        .current_dir(repo_path)
        .args(["rev-parse", "--verify", &normalized])
        .output()
        .await
        .map_err(|e| DomainError::Internal(e.to_string()))?;

    if !output.status.success() {
        return Err(DomainError::NotFound.into());
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
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
            FROM pipeline_runs p
            WHERE p.id = j.pipeline_run_id
              AND p.status IN (
                'cancelled'::pipeline_run_status,
                'failure'::pipeline_run_status
              )
          )
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
    let description = match status {
        "success" => "Job success".to_string(),
        "cancelled" => "Job cancelled".to_string(),
        other => format!("Job {other}"),
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
    .bind(description)
    .execute(pool)
    .await?;
    Ok(())
}

async fn finalize_pipeline_run_if_done(pool: &PgPool, pipeline_run_id: Uuid) -> Result<(), sqlx::Error> {
    let pipeline_status = sqlx::query_scalar::<_, String>(
        r#"SELECT status::text FROM pipeline_runs WHERE id = $1"#,
    )
    .bind(pipeline_run_id)
    .fetch_one(pool)
    .await?;

    if pipeline_status == "cancelled" {
        return Ok(());
    }

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

        let skipped = sqlx::query_as::<_, (Uuid, String)>(
            r#"
            UPDATE job_runs
            SET status = 'failure'::job_run_status,
                finished_at = NOW(),
                log_text = log_text || E'\n=== skipped: pipeline failed\n'
            WHERE pipeline_run_id = $1 AND status IN ('queued', 'running')
            RETURNING id, job_name
            "#,
        )
        .bind(pipeline_run_id)
        .fetch_all(pool)
        .await?;

        for (job_id, job_name) in skipped {
            let _ = update_commit_status_for_job(pool, job_id, "failure", &job_name).await;
        }

        let _ = release_idle_runners(pool).await;
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

async fn sync_pipeline_run_state(pool: &PgPool, pipeline_run_id: Uuid) -> Result<(), sqlx::Error> {
    reclaim_stale_running_jobs(pool).await?;
    finalize_pipeline_run_if_done(pool, pipeline_run_id).await?;
    force_finalize_stuck_pipeline(pool, pipeline_run_id).await
}

async fn force_finalize_stuck_pipeline(
    pool: &PgPool,
    pipeline_run_id: Uuid,
) -> Result<(), sqlx::Error> {
    let status = sqlx::query_scalar::<_, String>(
        r#"SELECT status::text FROM pipeline_runs WHERE id = $1"#,
    )
    .bind(pipeline_run_id)
    .fetch_one(pool)
    .await?;

    if !matches!(status.as_str(), "pending" | "queued" | "running") {
        return Ok(());
    }

    let active_jobs = sqlx::query_scalar::<_, i64>(
        r#"
        SELECT COUNT(*) FROM job_runs
        WHERE pipeline_run_id = $1 AND status IN ('queued', 'running')
        "#,
    )
    .bind(pipeline_run_id)
    .fetch_one(pool)
    .await?;

    if active_jobs > 0 {
        return Ok(());
    }

    let has_failed = sqlx::query_scalar::<_, bool>(
        r#"
        SELECT EXISTS(
            SELECT 1 FROM job_runs
            WHERE pipeline_run_id = $1 AND status = 'failure'
        )
        "#,
    )
    .bind(pipeline_run_id)
    .fetch_one(pool)
    .await?;

    let all_cancelled = sqlx::query_scalar::<_, bool>(
        r#"
        SELECT COUNT(*) > 0
           AND COUNT(*) = COUNT(*) FILTER (WHERE status = 'cancelled')
        FROM job_runs
        WHERE pipeline_run_id = $1
        "#,
    )
    .bind(pipeline_run_id)
    .fetch_one(pool)
    .await?;

    let new_status = if has_failed {
        "failure"
    } else if all_cancelled {
        "cancelled"
    } else {
        "success"
    };

    sqlx::query(
        r#"
        UPDATE pipeline_runs
        SET status = $2::pipeline_run_status,
            finished_at = COALESCE(finished_at, NOW())
        WHERE id = $1
        "#,
    )
    .bind(pipeline_run_id)
    .bind(new_status)
    .execute(pool)
    .await?;
    Ok(())
}

async fn ensure_pipeline_idle(
    pool: &PgPool,
    repo_id: Uuid,
    run_id: Uuid,
) -> Result<(), DomainError> {
    let exists = sqlx::query_scalar::<_, bool>(
        r#"
        SELECT EXISTS(
            SELECT 1 FROM pipeline_runs WHERE id = $1 AND repository_id = $2
        )
        "#,
    )
    .bind(run_id)
    .bind(repo_id)
    .fetch_one(pool)
    .await
    .map_err(|e| DomainError::Internal(e.to_string()))?;

    if !exists {
        return Err(DomainError::NotFound);
    }

    sync_pipeline_run_state(pool, run_id)
        .await
        .map_err(|e| DomainError::Internal(e.to_string()))?;

    let status = sqlx::query_scalar::<_, String>(
        r#"SELECT status::text FROM pipeline_runs WHERE id = $1"#,
    )
    .bind(run_id)
    .fetch_one(pool)
    .await
    .map_err(|e| DomainError::Internal(e.to_string()))?;

    let active_jobs = sqlx::query_scalar::<_, i64>(
        r#"
        SELECT COUNT(*) FROM job_runs
        WHERE pipeline_run_id = $1 AND status IN ('queued', 'running')
        "#,
    )
    .bind(run_id)
    .fetch_one(pool)
    .await
    .map_err(|e| DomainError::Internal(e.to_string()))?;

    if active_jobs > 0 || matches!(status.as_str(), "pending" | "queued" | "running") {
        return Err(DomainError::Validation(
            "pipeline is still running — cancel it first or wait for jobs to finish".into(),
        ));
    }

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
    needs: Vec<String>,
    steps_json: Value,
    metrics_json: Option<Value>,
    log_text: String,
    queued_at: DateTime<Utc>,
    started_at: Option<DateTime<Utc>>,
    finished_at: Option<DateTime<Utc>>,
}

fn steps_from_json(steps_json: &Value) -> Vec<JobStepResponse> {
    steps_json
        .as_array()
        .map(|steps| {
            steps
                .iter()
                .enumerate()
                .filter_map(|(index, step)| {
                    let run = step.get("run").and_then(|v| v.as_str()).unwrap_or("");
                    let uses = step.get("uses").and_then(|v| v.as_str());
                    if run.is_empty() && uses.is_none() {
                        return None;
                    }
                    let name = step
                        .get("name")
                        .and_then(|v| v.as_str())
                        .map(str::to_string)
                        .or_else(|| uses.map(str::to_string))
                        .unwrap_or_else(|| format!("step-{}", index + 1));
                    let display = if run.is_empty() {
                        uses.unwrap_or("").to_string()
                    } else {
                        run.to_string()
                    };
                    Some(JobStepResponse { name, run: display })
                })
                .collect()
        })
        .unwrap_or_default()
}

async fn fetch_job_artifacts(
    pool: &PgPool,
    job_run_id: Uuid,
) -> Result<Vec<JobArtifactResponse>, sqlx::Error> {
    let rows = sqlx::query_as::<_, JobArtifactRow>(
        r#"
        SELECT id, job_run_id, name, path, size_bytes, created_at, storage_key
        FROM job_artifacts
        WHERE job_run_id = $1
        ORDER BY created_at ASC
        "#,
    )
    .bind(job_run_id)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| JobArtifactResponse {
            id: row.id,
            job_run_id: row.job_run_id,
            name: row.name,
            path: row.path,
            size_bytes: row.size_bytes,
            created_at: row.created_at,
        })
        .collect())
}

async fn fetch_job_runs(pool: &PgPool, pipeline_run_id: Uuid) -> Result<Vec<JobRunResponse>, sqlx::Error> {
    let rows = sqlx::query_as::<_, JobRunRow>(
        r#"
        SELECT id, job_name, status::text, runs_on, needs, steps_json, metrics_json, log_text, queued_at, started_at, finished_at
        FROM job_runs
        WHERE pipeline_run_id = $1
        ORDER BY queued_at ASC
        "#,
    )
    .bind(pipeline_run_id)
    .fetch_all(pool)
    .await?;

    let mut jobs = Vec::with_capacity(rows.len());
    for row in rows {
        let artifacts = fetch_job_artifacts(pool, row.id).await?;
        jobs.push(JobRunResponse {
            id: row.id,
            job_name: row.job_name,
            status: row.status,
            runs_on: row.runs_on,
            needs: row.needs,
            steps: steps_from_json(&row.steps_json),
            artifacts,
            metrics_json: row.metrics_json,
            log_text: row.log_text,
            queued_at: row.queued_at,
            started_at: row.started_at,
            finished_at: row.finished_at,
        });
    }
    Ok(jobs)
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
struct RunnerInstanceRow {
    runner_id: Uuid,
    instance_id: String,
    host_ip: Option<String>,
    version: Option<String>,
    cpu_cores: Option<i32>,
    memory_total_mb: Option<i64>,
    memory_used_mb: Option<i64>,
    last_seen_at: DateTime<Utc>,
}

#[derive(sqlx::FromRow)]
struct RunnerK8sPodRow {
    runner_id: Uuid,
    job_run_id: Uuid,
    job_name: String,
    k8s_namespace: String,
    k8s_job_name: String,
    k8s_pod_name: Option<String>,
    phase: String,
    created_at: DateTime<Utc>,
}

#[derive(sqlx::FromRow)]
struct RunnerRow {
    id: Uuid,
    name: String,
    labels: Vec<String>,
    status: String,
    version: Option<String>,
    host_ip: Option<String>,
    host_name: Option<String>,
    cpu_cores: Option<i32>,
    memory_total_mb: Option<i64>,
    memory_used_mb: Option<i64>,
    disk_total_mb: Option<i64>,
    disk_free_mb: Option<i64>,
    last_job_name: Option<String>,
    last_job_status: Option<String>,
    last_job_at: Option<DateTime<Utc>>,
    current_job_name: Option<String>,
    last_seen_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
}

#[derive(sqlx::FromRow)]
struct CommitStatusRow {
    context: String,
    state: String,
    description: Option<String>,
    target_url: Option<String>,
    required: bool,
    updated_at: DateTime<Utc>,
}

#[derive(sqlx::FromRow)]
struct JobPollRow {
    id: Uuid,
    pipeline_run_id: Uuid,
    job_name: String,
    steps_json: Value,
    artifacts_json: Value,
    timeout_minutes: Option<i32>,
    repository_id: Uuid,
    commit_sha: String,
    ref_name: String,
    org_slug: String,
    repo_slug: String,
}

#[derive(sqlx::FromRow)]
struct JobArtifactRow {
    id: Uuid,
    job_run_id: Uuid,
    name: String,
    path: String,
    size_bytes: i64,
    created_at: DateTime<Utc>,
    storage_key: String,
}

async fn upload_runner_artifact(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(job_id): Path<Uuid>,
    mut multipart: Multipart,
) -> Result<StatusCode, (StatusCode, String)> {
    let runner_id = authenticate_runner(&state.pool, &headers).await?;

    let allowed = sqlx::query_scalar::<_, bool>(
        r#"
        SELECT EXISTS(
            SELECT 1 FROM job_runs
            WHERE id = $1 AND runner_id = $2 AND status IN ('running', 'success')
        )
        "#,
    )
    .bind(job_id)
    .bind(runner_id)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| internal(e.to_string()))?;

    if !allowed {
        return Err((StatusCode::FORBIDDEN, "job not assigned to runner".into()));
    }

    let mut name: Option<String> = None;
    let mut rel_path: Option<String> = None;
    let mut file_data: Option<bytes::Bytes> = None;

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| {
            tracing::warn!(%job_id, %e, "artifact multipart parse failed");
            internal(format!(
                "invalid multipart upload (artifact may exceed {} MiB limit): {e}",
                MAX_RUNNER_ARTIFACT_BYTES / (1024 * 1024)
            ))
        })?
    {
        match field.name() {
            Some("name") => {
                name = Some(field.text().await.map_err(|e| internal(e.to_string()))?);
            }
            Some("path") => {
                rel_path = Some(field.text().await.map_err(|e| internal(e.to_string()))?);
            }
            Some("file") => {
                file_data = Some(field.bytes().await.map_err(|e| internal(e.to_string()))?);
            }
            _ => {}
        }
    }

    let name = name.ok_or((StatusCode::BAD_REQUEST, "missing artifact name".into()))?;
    let rel_path = rel_path.unwrap_or_else(|| name.clone());
    let data = file_data.ok_or((StatusCode::BAD_REQUEST, "missing artifact file".into()))?;

    let safe_name = artifacts::sanitize_artifact_name(&name);
    let storage_key = ArtifactStore::storage_key(job_id, &safe_name);
    state
        .artifacts
        .put(&storage_key, &data)
        .await
        .map_err(|e| internal(e.to_string()))?;

    sqlx::query(
        r#"
        INSERT INTO job_artifacts (job_run_id, name, path, storage_key, size_bytes)
        VALUES ($1, $2, $3, $4, $5)
        "#,
    )
    .bind(job_id)
    .bind(&name)
    .bind(&rel_path)
    .bind(&storage_key)
    .bind(data.len() as i64)
    .execute(&state.pool)
    .await
    .map_err(|e| internal(e.to_string()))?;

    Ok(StatusCode::CREATED)
}

async fn download_pipeline_artifact(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_slug, repo_slug, run_id, artifact_id)): Path<(String, String, Uuid, Uuid)>,
) -> Result<Response, ApiError> {
    let (_org, repo, _repo_path) =
        load_repo_for_read(&state, &org_slug, &repo_slug, Some(&auth)).await?;

    let artifact = sqlx::query_as::<_, JobArtifactRow>(
        r#"
        SELECT a.id, a.job_run_id, a.name, a.path, a.size_bytes, a.created_at, a.storage_key
        FROM job_artifacts a
        INNER JOIN job_runs j ON j.id = a.job_run_id
        INNER JOIN pipeline_runs p ON p.id = j.pipeline_run_id
        WHERE a.id = $1 AND p.id = $2 AND p.repository_id = $3
        "#,
    )
    .bind(artifact_id)
    .bind(run_id)
    .bind(repo.id)
    .fetch_optional(&state.pool)
    .await
    .map_err(sqlx_error)?
    .ok_or(DomainError::NotFound)?;

    let data = state
        .artifacts
        .get(&artifact.storage_key)
        .await
        .map_err(|e| DomainError::Internal(e.to_string()))?;

    let filename = artifacts::download_filename(&artifact.name);
    let disposition = format!("attachment; filename=\"{filename}\"");
    let headers = [
        (header::CONTENT_TYPE, "application/gzip"),
        (
            header::CONTENT_DISPOSITION,
            disposition.as_str(),
        ),
    ];

    Ok((
        StatusCode::OK,
        headers,
        Body::from(data),
    )
        .into_response())
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

#[derive(Debug)]
enum CancelError {
    NotFound,
    NotCancellable,
}

#[derive(Serialize)]
struct RunnerJobControlResponse {
    pipeline_cancelled: bool,
    job_cancelled: bool,
    cancel_requested: bool,
    cancel_step_name: Option<String>,
    timed_out: bool,
}

async fn runner_job_control(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(job_id): Path<Uuid>,
) -> Result<Json<RunnerJobControlResponse>, (StatusCode, String)> {
    let runner_id = authenticate_runner(&state.pool, &headers).await?;

    let row = sqlx::query_as::<_, (String, String, Option<String>, Option<DateTime<Utc>>, bool)>(
        r#"
        SELECT
            p.status::text,
            j.status::text,
            j.cancel_step_name,
            j.cancel_requested_at,
            (
                j.timeout_minutes IS NOT NULL
                AND j.started_at IS NOT NULL
                AND j.started_at + make_interval(mins => j.timeout_minutes) < NOW()
            ) AS timed_out
        FROM job_runs j
        INNER JOIN pipeline_runs p ON p.id = j.pipeline_run_id
        WHERE j.id = $1 AND j.runner_id = $2
        "#,
    )
    .bind(job_id)
    .bind(runner_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| internal(e.to_string()))?
    .ok_or((StatusCode::NOT_FOUND, "job not found".into()))?;

    Ok(Json(RunnerJobControlResponse {
        pipeline_cancelled: row.0 == "cancelled" || row.0 == "failure",
        job_cancelled: row.1 == "cancelled",
        cancel_requested: row.3.is_some(),
        cancel_step_name: row.2,
        timed_out: row.4,
    }))
}

async fn runner_job_secrets(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(job_id): Path<Uuid>,
) -> Result<Json<crate::ci_secrets::RunnerJobSecretsResponse>, (StatusCode, String)> {
    let runner_id = authenticate_runner(&state.pool, &headers).await?;
    let secrets = crate::ci_secrets::load_job_secrets_for_runner(
        &state.pool,
        &state.secrets_crypto,
        job_id,
        runner_id,
    )
    .await?;
    Ok(Json(secrets))
}

async fn cancel_pipeline_run(
    pool: &PgPool,
    repo_id: Uuid,
    run_id: Uuid,
) -> Result<(), CancelError> {
    let status = sqlx::query_scalar::<_, String>(
        r#"
        SELECT status::text
        FROM pipeline_runs
        WHERE id = $1 AND repository_id = $2
        "#,
    )
    .bind(run_id)
    .bind(repo_id)
    .fetch_optional(pool)
    .await
    .map_err(|_| CancelError::NotFound)?
    .ok_or(CancelError::NotFound)?;

    if !matches!(status.as_str(), "pending" | "queued" | "running") {
        return Err(CancelError::NotCancellable);
    }

    let mut tx = pool.begin().await.map_err(|_| CancelError::NotFound)?;

    sqlx::query(
        r#"
        UPDATE pipeline_runs
        SET status = 'cancelled'::pipeline_run_status,
            finished_at = NOW()
        WHERE id = $1 AND repository_id = $2
        "#,
    )
    .bind(run_id)
    .bind(repo_id)
    .execute(&mut *tx)
    .await
    .map_err(|_| CancelError::NotFound)?;

    let queued_jobs = sqlx::query_as::<_, (Uuid, String)>(
        r#"
        UPDATE job_runs
        SET status = 'cancelled'::job_run_status,
            finished_at = NOW(),
            log_text = log_text || E'\n=== pipeline cancelled\n'
        WHERE pipeline_run_id = $1 AND status = 'queued'
        RETURNING id, job_name
        "#,
    )
    .bind(run_id)
    .fetch_all(&mut *tx)
    .await
    .map_err(|_| CancelError::NotFound)?;

    let running_jobs = sqlx::query_as::<_, (Uuid, String)>(
        r#"
        UPDATE job_runs
        SET status = 'cancelled'::job_run_status,
            finished_at = NOW(),
            cancel_requested_at = COALESCE(cancel_requested_at, NOW()),
            log_text = log_text || E'\n=== pipeline cancelled\n'
        WHERE pipeline_run_id = $1 AND status = 'running'
        RETURNING id, job_name
        "#,
    )
    .bind(run_id)
    .fetch_all(&mut *tx)
    .await
    .map_err(|_| CancelError::NotFound)?;

    tx.commit().await.map_err(|_| CancelError::NotFound)?;

    for (job_id, job_name) in queued_jobs
        .into_iter()
        .chain(running_jobs.into_iter())
    {
        let _ = update_commit_status_for_job(pool, job_id, "cancelled", &job_name).await;
    }

    let _ = release_idle_runners(pool).await;

    Ok(())
}

async fn cancel_job_step_run(
    pool: &PgPool,
    repo_id: Uuid,
    run_id: Uuid,
    job_id: Uuid,
    step_name: Option<&str>,
) -> Result<(), CancelError> {
    let row = sqlx::query_as::<_, (String, String)>(
        r#"
        SELECT j.status::text, p.status::text
        FROM job_runs j
        INNER JOIN pipeline_runs p ON p.id = j.pipeline_run_id
        WHERE j.id = $1 AND j.pipeline_run_id = $2 AND p.repository_id = $3
        "#,
    )
    .bind(job_id)
    .bind(run_id)
    .bind(repo_id)
    .fetch_optional(pool)
    .await
    .map_err(|_| CancelError::NotFound)?
    .ok_or(CancelError::NotFound)?;

    if row.0 != "running" || row.1 == "cancelled" {
        return Err(CancelError::NotCancellable);
    }

    let cancelled = sqlx::query_as::<_, (String,)>(
        r#"
        UPDATE job_runs
        SET status = 'cancelled'::job_run_status,
            finished_at = NOW(),
            cancel_requested_at = NOW(),
            cancel_step_name = $2,
            log_text = log_text || E'\n=== step cancelled\n'
        WHERE id = $1 AND status = 'running'
        RETURNING job_name
        "#,
    )
    .bind(job_id)
    .bind(step_name)
    .fetch_optional(pool)
    .await
    .map_err(|_| CancelError::NotFound)?
    .ok_or(CancelError::NotCancellable)?;

    let job_name = cancelled.0;
    let _ = update_commit_status_for_job(pool, job_id, "cancelled", &job_name).await;
    let _ = finalize_pipeline_run_if_done(pool, run_id).await;
    let _ = release_idle_runners(pool).await;

    Ok(())
}
