use std::path::PathBuf;
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
        Commands::Run => run_loop(&cli).await,
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
    repos_root: Option<&std::path::Path>,
    org_slug: &str,
    repo_slug: &str,
    commit_sha: &str,
    workspace: &std::path::Path,
) -> anyhow::Result<()> {
    let repo_path = if let Some(root) = repos_root {
        root.join(org_slug).join(format!("{repo_slug}.git"))
    } else {
        anyhow::bail!("PERTISK_REPOS_ROOT is required to checkout repository content");
    };

    if !repo_path.is_dir() {
        anyhow::bail!("repository not found: {}", repo_path.display());
    }

    tokio::fs::create_dir_all(workspace)
        .await
        .with_context(|| format!("create workspace {}", workspace.display()))?;

    // Read-only checkout from bare repo: keep index in runner temp dir so we never
    // write index.lock into the pertisk-gits-owned repository.
    let index_file = workspace
        .parent()
        .map(|dir| dir.join("index"))
        .unwrap_or_else(|| workspace.join(".git-index"));

    let git_base = |command: &mut Command| {
        command
            .args(["-c", "safe.directory=*"])
            .env("GIT_DIR", &repo_path)
            .env("GIT_INDEX_FILE", &index_file)
            .arg("--work-tree")
            .arg(workspace);
    };

    let read_tree = {
        let mut command = Command::new("git");
        git_base(&mut command);
        command
            .args(["read-tree", commit_sha])
            .output()
            .await
            .context("git read-tree")?
    };

    if !read_tree.status.success() {
        anyhow::bail!(
            "git read-tree failed: {}",
            String::from_utf8_lossy(&read_tree.stderr)
        );
    }

    let checkout = {
        let mut command = Command::new("git");
        git_base(&mut command);
        command
            .args(["checkout-index", "-a", "-f"])
            .output()
            .await
            .context("git checkout-index")?
    };

    if !checkout.status.success() {
        anyhow::bail!(
            "git checkout-index failed: {}",
            String::from_utf8_lossy(&checkout.stderr)
        );
    }

    let _ = tokio::fs::remove_file(&index_file).await;

    let mut entries = tokio::fs::read_dir(workspace).await.context("read workspace")?;
    if entries.next_entry().await?.is_none() {
        anyhow::bail!(
            "checkout produced empty workspace for commit {commit_sha}; \
             verify the commit has tracked files"
        );
    }

    Ok(())
}
