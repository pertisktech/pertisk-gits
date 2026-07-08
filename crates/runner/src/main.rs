mod api;
mod artifacts;
mod host;
mod job;
mod k8s;
mod log_stream;
mod version;
mod workspace;

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use std::time::Instant;

use anyhow::Context;
use clap::{Parser, Subcommand};
use pertisk_cicd::{bench_noop_steps, ShellExecutor};
use tempfile::TempDir;
use tokio::sync::Semaphore;
use tracing_subscriber::EnvFilter;

use crate::api::RunnerApi;
use crate::host::collect_host_info;
use crate::version::APP_VERSION;

#[derive(Parser)]
#[command(name = "pertisk-runner", about = "Pertisk Gits CI runner")]
struct Cli {
    #[command(subcommand)]
    command: Option<Commands>,

    #[arg(long, env = "PERTISK_API_URL", default_value = "http://127.0.0.1:8080")]
    api_url: String,

    #[arg(long, env = "PERTISK_RUNNER_TOKEN")]
    token: Option<String>,

    #[arg(long, env = "PERTISK_REPOS_ROOT")]
    repos_root: Option<PathBuf>,

    /// Maximum number of jobs this runner process executes concurrently.
    #[arg(long, env = "PERTISK_RUNNER_MAX_PARALLEL", default_value_t = 1)]
    max_parallel: usize,

    /// Long-poll timeout (seconds) for /api/v1/runner/jobs requests.
    /// Keep this below reverse-proxy upstream timeouts.
    #[arg(long, env = "PERTISK_RUNNER_POLL_TIMEOUT_SECS", default_value_t = 20)]
    poll_timeout_secs: u64,

    /// Exit runner after being idle (no jobs claimed) for this many seconds.
    /// Set to 0 to disable auto-exit.
    #[arg(long, env = "PERTISK_RUNNER_EXIT_ON_IDLE_SECS", default_value_t = 0)]
    exit_on_idle_secs: u64,
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
                executor = %job::runner_executor(),
                max_parallel = cli.max_parallel,
                poll_timeout_secs = cli.poll_timeout_secs,
                exit_on_idle_secs = cli.exit_on_idle_secs,
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
    let max_parallel = cli.max_parallel.max(1);
    let job_slots = Arc::new(Semaphore::new(max_parallel));
    let mut shutdown = false;
    let mut last_job_claimed_at = Instant::now();

    while !shutdown {
        let host = collect_host_info();
        if let Err(err) = api.heartbeat(&host).await {
            tracing::warn!("heartbeat failed: {err:#}");
        }

        let permit = tokio::select! {
            permit = job_slots.clone().acquire_owned() => permit,
            _ = wait_shutdown_signal() => {
                shutdown = true;
                continue;
            }
        };
        let Ok(permit) = permit else {
            break;
        };

        let poll_timeout_secs = cli.poll_timeout_secs.clamp(1, 55);

        let poll = tokio::select! {
            poll = api.poll_job(poll_timeout_secs) => poll,
            _ = wait_shutdown_signal() => {
                shutdown = true;
                drop(permit);
                continue;
            }
        };

        let poll = match poll {
            Ok(job) => job,
            Err(err) if err.to_string().contains("unauthorized") => {
                drop(permit);
                tracing::error!(
                    "invalid runner token (401 Unauthorized); runner registration is revoked or deleted, shutting down"
                );
                shutdown = true;
                continue;
            }
            Err(err) => return Err(err),
        };

        let Some(job) = poll else {
            drop(permit);

            if cli.exit_on_idle_secs > 0 {
                let idle_for = last_job_claimed_at.elapsed().as_secs();
                if idle_for >= cli.exit_on_idle_secs {
                    tracing::info!(
                        idle_for_secs = idle_for,
                        exit_on_idle_secs = cli.exit_on_idle_secs,
                        "runner idle timeout reached; shutting down"
                    );
                    shutdown = true;
                }
            }

            tokio::time::sleep(Duration::from_secs(2)).await;

            continue;
        };

        last_job_claimed_at = Instant::now();

        let job_api = api.clone_for_poll();
        let heartbeat_api = api.clone_for_poll();
        let repos_root = cli.repos_root.clone();
        tokio::spawn(async move {
            let _permit = permit;
            let heartbeat_task = tokio::spawn(async move {
                loop {
                    tokio::time::sleep(Duration::from_secs(30)).await;
                    let host = collect_host_info();
                    if let Err(err) = heartbeat_api.heartbeat(&host).await {
                        tracing::warn!("heartbeat during job failed: {err:#}");
                    }
                }
            });

            let job_result = job::run_job(&job_api, job, repos_root.as_deref()).await;
            heartbeat_task.abort();

            if let Err(err) = job_result {
                tracing::error!("job failed: {err:#}");
            }
        });
    }

    // Wait for in-flight jobs before deregistering.
    let _ = job_slots.acquire_many(max_parallel as u32).await;

    let host = collect_host_info();
    if let Err(err) = api.deregister_instance(&host).await {
        tracing::warn!("deregister instance failed: {err:#}");
    }
    tracing::info!(host = %host.host_name, "runner shutting down");
    Ok(())
}

async fn wait_shutdown_signal() {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{signal, SignalKind};
        let mut term = signal(SignalKind::terminate()).expect("SIGTERM handler");
        let mut int = signal(SignalKind::interrupt()).expect("SIGINT handler");
        tokio::select! {
            _ = term.recv() => {}
            _ = int.recv() => {}
        }
    }
    #[cfg(not(unix))]
    {
        tokio::signal::ctrl_c()
            .await
            .expect("ctrl-c handler");
    }
}
