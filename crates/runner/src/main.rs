use std::path::PathBuf;
use std::process::Stdio;
use std::time::{Duration, Instant};

use anyhow::Context;
use clap::{Parser, Subcommand};
use pertisk_cicd::{config::Step, bench_noop_steps, JobExecutor, ShellExecutor};
use serde::Deserialize;
use serde_json::Value;
use tempfile::TempDir;
use tokio::process::Command;
use tracing_subscriber::EnvFilter;

#[derive(Parser)]
#[command(name = "pertisk-runner", about = "Pertisk Gits self-hosted CI runner")]
struct Cli {
    #[command(subcommand)]
    command: Option<Commands>,

    #[arg(long, env = "PERTISK_API_URL", default_value = "http://127.0.0.1:8080")]
    api_url: String,

    #[arg(long, env = "PERTISK_RUNNER_TOKEN")]
    token: Option<String>,

    #[arg(long, env = "PERTISK_REPOS_ROOT")]
    repos_root: Option<PathBuf>,
}

#[derive(Subcommand, Clone)]
enum Commands {
    /// Poll API and execute queued jobs (default)
    Run,
    /// Measure runner step overhead (no API)
    Bench {
        #[arg(long, default_value_t = 100)]
        iterations: u32,
    },
}

#[derive(Deserialize)]
struct PollJobResponse {
    job_id: uuid::Uuid,
    job_name: String,
    org_slug: String,
    repo_slug: String,
    commit_sha: String,
    steps: Vec<Step>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();

    let cli = Cli::parse();
    match cli.command.clone().unwrap_or(Commands::Run) {
        Commands::Bench { iterations } => run_bench(iterations).await,
        Commands::Run => {
            tracing::info!(
                version = env!("CARGO_PKG_VERSION"),
                api = %cli.api_url,
                repos_root = ?cli.repos_root,
                "pertisk-runner starting"
            );
            run_loop(&cli).await
        }
    }
}

async fn run_bench(iterations: u32) -> anyhow::Result<()> {
    let workspace = TempDir::new()?;
    let executor = ShellExecutor::new();
    let report = bench_noop_steps(&executor, workspace.path(), iterations).await;
    println!("{}", serde_json::to_string_pretty(&report)?);
    Ok(())
}

async fn run_loop(cli: &Cli) -> anyhow::Result<()> {
    let token = cli
        .token
        .clone()
        .context("set PERTISK_RUNNER_TOKEN or pass --token")?;
    let client = reqwest::Client::new();
    let api = cli.api_url.trim_end_matches('/');

    loop {
        client
            .post(format!("{api}/api/v1/runner/heartbeat"))
            .bearer_auth(&token)
            .send()
            .await
            .ok();

        let poll = client
            .get(format!("{api}/api/v1/runner/jobs"))
            .query(&[("timeout_secs", "25")])
            .bearer_auth(&token)
            .send()
            .await
            .context("poll jobs")?;

        if poll.status() == reqwest::StatusCode::UNAUTHORIZED {
            tracing::error!(
                "invalid runner token (401 Unauthorized); update PERTISK_RUNNER_TOKEN and restart"
            );
            tokio::time::sleep(Duration::from_secs(30)).await;
            continue;
        }

        if !poll.status().is_success() {
            anyhow::bail!("poll failed: {}", poll.status());
        }

        let body: Option<PollJobResponse> = poll.json().await?;
        let Some(job) = body else {
            continue;
        };

        tracing::info!(job = %job.job_name, repo = %format!("{}/{}", job.org_slug, job.repo_slug), "running job");
        let queued_at = Instant::now();

        client
            .post(format!("{api}/api/v1/runner/jobs/{}/start", job.job_id))
            .bearer_auth(&token)
            .send()
            .await?;

        let work_root = TempDir::with_prefix("pertisk-ci-")?;
        let workspace = work_root.path().join(&job.repo_slug);
        if let Err(err) = materialize_workspace(
            &client,
            api,
            &token,
            job.job_id,
            cli.repos_root.as_deref(),
            &job.org_slug,
            &job.repo_slug,
            &job.commit_sha,
            &workspace,
        )
        .await
        {
            complete_job(&client, api, &token, job.job_id, "failure", &format!("checkout failed: {err:#}"), None).await?;
            continue;
        }

        let executor = ShellExecutor::new();
        let queue_wait = queued_at.elapsed();
        let job_env = [
            ("CI_PROJECT_DIR", workspace.display().to_string()),
            ("CI_COMMIT_SHA", job.commit_sha.clone()),
            (
                "CI_REPOSITORY_SLUG",
                format!("{}/{}", job.org_slug, job.repo_slug),
            ),
        ];
        let (metrics, outputs) = executor
            .execute_steps(
                &job.job_name,
                &workspace,
                &job.steps,
                queue_wait,
                &job_env,
            )
            .await;

        let mut log = String::new();
        for output in &outputs {
            log.push_str(&format!("=== {} (exit {})\n", output.name, output.exit_code));
            if !output.stdout.is_empty() {
                log.push_str(&output.stdout);
                if !output.stdout.ends_with('\n') {
                    log.push('\n');
                }
            }
            if !output.stderr.is_empty() {
                log.push_str(&output.stderr);
                if !output.stderr.ends_with('\n') {
                    log.push('\n');
                }
            }
        }

        let failed = outputs.iter().any(|o| o.exit_code != 0);
        let status = if failed { "failure" } else { "success" };
        let metrics_json = serde_json::to_value(&metrics).ok();
        complete_job(&client, api, &token, job.job_id, status, &log, metrics_json).await?;
        tracing::info!(job = %job.job_name, status, execution_ms = metrics.execution_ms, "job finished");
    }
}

async fn complete_job(
    client: &reqwest::Client,
    api: &str,
    token: &str,
    job_id: uuid::Uuid,
    status: &str,
    log_text: &str,
    metrics_json: Option<Value>,
) -> anyhow::Result<()> {
    client
        .post(format!("{api}/api/v1/runner/jobs/{job_id}/complete"))
        .bearer_auth(token)
        .json(&serde_json::json!({
            "status": status,
            "log_text": log_text,
            "metrics_json": metrics_json,
        }))
        .send()
        .await?;
    Ok(())
}

async fn materialize_workspace(
    client: &reqwest::Client,
    api: &str,
    token: &str,
    job_id: uuid::Uuid,
    repos_root: Option<&std::path::Path>,
    org_slug: &str,
    repo_slug: &str,
    commit_sha: &str,
    workspace: &std::path::Path,
) -> anyhow::Result<()> {
    if let Some(root) = repos_root {
        if pertisk_git::repo_exists_on_disk(root, org_slug, repo_slug) {
            let repo_path = pertisk_git::config::repo_disk_path(root, org_slug, repo_slug);
            tracing::debug!(path = %repo_path.display(), "checking out from local bare repo");
            return pertisk_git::workspace::checkout_commit(&repo_path, commit_sha, workspace).await;
        }
        let repo_path = pertisk_git::config::repo_disk_path(root, org_slug, repo_slug);
        tracing::info!(
            repo = %format!("{org_slug}/{repo_slug}"),
            path = %repo_path.display(),
            "local bare repo not found; fetching workspace from API"
        );
    } else {
        tracing::info!(
            repo = %format!("{org_slug}/{repo_slug}"),
            "PERTISK_REPOS_ROOT unset; fetching workspace from API"
        );
    }

    materialize_workspace_remote(client, api, token, job_id, workspace).await
}

async fn materialize_workspace_remote(
    client: &reqwest::Client,
    api: &str,
    token: &str,
    job_id: uuid::Uuid,
    workspace: &std::path::Path,
) -> anyhow::Result<()> {
    tokio::fs::create_dir_all(workspace)
        .await
        .with_context(|| format!("create workspace {}", workspace.display()))?;

    let response = client
        .get(format!("{api}/api/v1/runner/jobs/{job_id}/workspace"))
        .bearer_auth(token)
        .send()
        .await
        .context("download workspace from API")?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        anyhow::bail!(
            "API workspace download failed ({status}): {body} \
             (check PERTISK_API_URL points at pertisk-gits API, not 127.0.0.1 on a remote host)"
        );
    }

    let bytes = response.bytes().await.context("read workspace archive")?;

    let mut child = Command::new("tar")
        .args(["xzf", "-", "-C"])
        .arg(workspace)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .context("spawn tar")?;

    let mut stdin = child
        .stdin
        .take()
        .context("tar stdin not available")?;
    tokio::io::AsyncWriteExt::write_all(&mut stdin, &bytes)
        .await
        .context("write tar stdin")?;
    drop(stdin);

    let output = child.wait_with_output().await.context("tar extract")?;
    if !output.status.success() {
        anyhow::bail!(
            "tar extract failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    let mut entries = tokio::fs::read_dir(workspace).await.context("read workspace")?;
    if entries.next_entry().await?.is_none() {
        anyhow::bail!("API workspace was empty after extract");
    }

    Ok(())
}
