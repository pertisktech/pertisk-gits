mod api;
mod artifacts;
mod host;
mod job;
mod log_stream;
mod version;
mod workspace;

use std::path::PathBuf;
use std::time::Duration;

use anyhow::Context;
use clap::{Parser, Subcommand};
use pertisk_cicd::{bench_noop_steps, ShellExecutor};
use tempfile::TempDir;
use tracing_subscriber::EnvFilter;

use crate::api::RunnerApi;
use crate::host::collect_host_info;
use crate::version::APP_VERSION;

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

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();

    let cli = Cli::parse();
    match cli.command.clone().unwrap_or(Commands::Run) {
        Commands::Bench { iterations } => run_bench(iterations).await,
        Commands::Run => {
            let host = collect_host_info();
            tracing::info!(
                version = %APP_VERSION,
                host = %host.host_name,
                ip = ?host.host_ip,
                cpu = host.cpu_cores,
                memory_mb = host.memory_used_mb,
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
    let api = RunnerApi::new(&cli.api_url, token);

    loop {
        let host = collect_host_info();
        if let Err(err) = api.heartbeat(&host).await {
            tracing::warn!("heartbeat failed: {err:#}");
        }

        let poll = match api.poll_job(25).await {
            Ok(job) => job,
            Err(err) if err.to_string().contains("unauthorized") => {
                tracing::error!(
                    "invalid runner token (401 Unauthorized); update PERTISK_RUNNER_TOKEN and restart"
                );
                tokio::time::sleep(Duration::from_secs(30)).await;
                continue;
            }
            Err(err) => return Err(err),
        };

        let Some(job) = poll else {
            continue;
        };

        let hb_api = api.clone_for_poll();
        let heartbeat_task = tokio::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_secs(30)).await;
                let host = collect_host_info();
                if let Err(err) = hb_api.heartbeat(&host).await {
                    tracing::warn!("heartbeat during job failed: {err:#}");
                }
            }
        });

        let job_result = job::run_job(&api, job, cli.repos_root.as_deref()).await;
        heartbeat_task.abort();

        if let Err(err) = job_result {
            tracing::error!("job failed: {err:#}");
        }
    }
}
