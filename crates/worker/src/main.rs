use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use clap::Parser;
use pertisk_cicd::{
    parse_pipeline_yaml, pipeline_event_from_ref, RunContext, Scheduler, TriggerMatcher, CONFIG_PATHS,
};
use sqlx::PgPool;
use tokio::process::Command;
use tracing_subscriber::EnvFilter;
use uuid::Uuid;

use pertisk_worker::import::ImportWorker;

#[derive(Parser)]
#[command(name = "pertisk-worker", about = "Pertisk Gits CI scheduler worker")]
struct Cli {
    #[arg(long, env = "DATABASE_URL")]
    database_url: String,

    #[arg(long, env = "REPOS_ROOT", default_value = "data/repos")]
    repos_root: PathBuf,

    #[arg(long, env = "WORKER_POLL_SECS", default_value_t = 2)]
    poll_secs: u64,
}

#[derive(Clone)]
struct WorkerState {
    pool: PgPool,
    repos_root: Arc<PathBuf>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();

    let cli = Cli::parse();
    let pool = PgPool::connect(&cli.database_url).await?;
    sqlx::migrate!("../../migrations").run(&pool).await?;

    let state = WorkerState {
        pool: pool.clone(),
        repos_root: Arc::new(cli.repos_root),
    };

    let import_worker = ImportWorker::from_env(pool.clone(), state.repos_root.clone())?;
    let index_root = Arc::new(pertisk_worker::search::default_index_root());
    pertisk_worker::search::ensure_index_root(&index_root)?;
    let search_worker = pertisk_worker::search::CodeIndexWorker::new(
        pool.clone(),
        state.repos_root.clone(),
        index_root,
    );

    tracing::info!(poll_secs = cli.poll_secs, "pertisk-worker started");
    loop {
        match process_pending_triggers(&state).await {
            Ok(count) if count > 0 => tracing::info!(processed = count, "pipeline triggers processed"),
            Ok(_) => {}
            Err(err) => tracing::warn!("trigger processing failed: {err:#}"),
        }
        match import_worker.process_pending_jobs().await {
            Ok(count) if count > 0 => tracing::info!(processed = count, "import jobs processed"),
            Ok(_) => {}
            Err(err) => tracing::warn!("import processing failed: {err:#}"),
        }
        match search_worker.process_pending_jobs().await {
            Ok(count) if count > 0 => tracing::info!(processed = count, "code index jobs processed"),
            Ok(_) => {}
            Err(err) => tracing::warn!("code index processing failed: {err:#}"),
        }
        tokio::time::sleep(Duration::from_secs(cli.poll_secs)).await;
    }
}

async fn process_pending_triggers(state: &WorkerState) -> anyhow::Result<u32> {
    let triggers = sqlx::query_as::<_, TriggerRow>(
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

    let mut processed = 0u32;
    for trigger in triggers {
        if let Some((org_slug, repo_slug)) = repo_slugs(&state.pool, trigger.repository_id).await? {
            if let Err(err) = process_trigger_now(
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
                tracing::debug!("trigger {} skipped: {err:#}", trigger.id);
            }
        }
        mark_trigger_processed(&state.pool, trigger.id).await?;
        processed += 1;
    }
    Ok(processed)
}

async fn process_trigger_now(
    state: &WorkerState,
    repository_id: Uuid,
    org_slug: &str,
    repo_slug: &str,
    commit_sha: &str,
    ref_name: &str,
    event_type: &str,
) -> anyhow::Result<Uuid> {
    let repo_path = state.repos_root.join(org_slug).join(format!("{repo_slug}.git"));
    let Some((config_yaml, config_path)) = read_pipeline_config(&repo_path, commit_sha).await else {
        anyhow::bail!("no pipeline config at commit {commit_sha}");
    };

    let config = parse_pipeline_yaml(&config_yaml)?;
    let event = pipeline_event_from_ref(event_type, ref_name);

    if !TriggerMatcher::matches(&config, &event) {
        anyhow::bail!("event does not match pipeline triggers");
    }

    let run_ctx = RunContext::from_trigger(event_type, ref_name);
    let scheduled = Scheduler::schedule_for_run(&config, &run_ctx)?;
    let has_runnable = scheduled.iter().any(|job| !job.skipped);

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

    for job in scheduled {
        let steps_json = serde_json::to_value(&job.job.steps)?;
        let artifacts_json = serde_json::to_value(&job.job.artifacts)?;
        let status = if job.skipped { "skipped" } else { "queued" };
        let initial_log = if job.skipped {
            "=== skipped (if condition not met)\n"
        } else {
            ""
        };
        sqlx::query(
            r#"
            INSERT INTO job_runs (pipeline_run_id, job_name, runs_on, steps_json, artifacts_json, needs, timeout_minutes, status, log_text, finished_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8::job_run_status, $9, CASE WHEN $10 THEN NOW() ELSE NULL END)
            "#,
        )
        .bind(run_id)
        .bind(&job.name)
        .bind(&job.job.runs_on)
        .bind(steps_json)
        .bind(artifacts_json)
        .bind(&job.job.needs)
        .bind(job.job.timeout_minutes.map(|m| m as i32))
        .bind(status)
        .bind(initial_log)
        .bind(job.skipped)
        .execute(&state.pool)
        .await?;

        let (commit_state, commit_description) = if job.skipped {
            ("success", "Skipped")
        } else {
            ("pending", "Queued")
        };
        sqlx::query(
            r#"
            INSERT INTO commit_statuses (repository_id, commit_sha, context, state, description, pipeline_run_id, required)
            VALUES ($1, $2, $3, $4::commit_status_state, $5, $6, $7)
            ON CONFLICT (repository_id, commit_sha, context)
            DO UPDATE SET
                state = EXCLUDED.state,
                description = EXCLUDED.description,
                updated_at = NOW(),
                pipeline_run_id = EXCLUDED.pipeline_run_id,
                required = EXCLUDED.required
            "#,
        )
        .bind(repository_id)
        .bind(commit_sha)
        .bind(format!("ci/{}", job.name))
        .bind(commit_state)
        .bind(commit_description)
        .bind(run_id)
        .bind(job.job.required)
        .execute(&state.pool)
        .await?;
    }

    sqlx::query(
        r#"
        UPDATE pipeline_runs
        SET status = CASE
            WHEN $2 THEN 'running'::pipeline_run_status
            ELSE 'skipped'::pipeline_run_status
        END,
        finished_at = CASE WHEN $2 THEN NULL ELSE NOW() END
        WHERE id = $1
        "#,
    )
    .bind(run_id)
    .bind(has_runnable)
    .execute(&state.pool)
    .await?;

    Ok(run_id)
}

async fn read_pipeline_config(repo_path: &Path, commit_sha: &str) -> Option<(String, String)> {
    for path in CONFIG_PATHS {
        let output = Command::new("git")
            .current_dir(repo_path)
            .args(["show", &format!("{commit_sha}:{path}")])
            .output()
            .await
            .ok()?;
        if output.status.success() {
            let yaml = String::from_utf8_lossy(&output.stdout).into_owned();
            if !yaml.trim().is_empty() {
                return Some((yaml, (*path).to_string()));
            }
        }
    }
    None
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

async fn mark_trigger_processed(pool: &PgPool, trigger_id: Uuid) -> anyhow::Result<()> {
    sqlx::query("UPDATE pipeline_triggers SET processed = TRUE WHERE id = $1")
        .bind(trigger_id)
        .execute(pool)
        .await?;
    Ok(())
}

#[derive(sqlx::FromRow)]
struct TriggerRow {
    id: Uuid,
    repository_id: Uuid,
    commit_sha: String,
    ref_name: String,
    event_type: String,
}
