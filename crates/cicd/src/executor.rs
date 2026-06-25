use std::path::Path;
use std::process::Stdio;
use std::time::{Duration, Instant};

use chrono::Utc;
use tokio::io::AsyncReadExt;
use tokio::process::Command;
use tokio::sync::mpsc;

use crate::config::Step;
use crate::metrics::{JobMetrics, StepTiming};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StepOutput {
    pub name: String,
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
    pub duration: Duration,
}

pub trait JobExecutor {
    fn execute_steps(
        &self,
        job_name: &str,
        workspace: &Path,
        steps: &[Step],
        queue_wait: Duration,
        job_env: &[(&str, String)],
    ) -> impl std::future::Future<Output = (JobMetrics, Vec<StepOutput>)> + Send;
}

#[derive(Debug, Clone, Default)]
pub struct ShellExecutor {
    pub shell: String,
}

impl ShellExecutor {
    pub fn new() -> Self {
        Self {
            shell: std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into()),
        }
    }

    fn shell_invocation(&self, script: &str) -> String {
        if std::path::Path::new("/usr/bin/stdbuf").exists() {
            format!("stdbuf -oL -eL {script}")
        } else {
            script.to_string()
        }
    }

    pub async fn run_step(
        &self,
        workspace: &Path,
        index: usize,
        step: &Step,
        job_env: &[(&str, String)],
    ) -> StepOutput {
        let name = step
            .name
            .clone()
            .unwrap_or_else(|| format!("step-{index}"));
        let cwd = step
            .working_directory
            .as_ref()
            .map(|rel| workspace.join(rel))
            .unwrap_or_else(|| workspace.to_path_buf());

        let started = Instant::now();

        let mut command = Command::new(&self.shell);
        command
            .arg("-lc")
            .arg(self.shell_invocation(&step.run))
            .current_dir(cwd)
            .env("CI", "true")
            .env("PERTISK_CI", "true")
            .env("PYTHONUNBUFFERED", "1");

        for (key, value) in job_env {
            command.env(key, value);
        }

        for (key, value) in &step.env {
            command.env(key, value);
        }

        let output = command.output().await;
        let duration = started.elapsed();

        match output {
            Ok(out) => StepOutput {
                name,
                exit_code: out.status.code().unwrap_or(1),
                stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
                stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
                duration,
            },
            Err(err) => StepOutput {
                name,
                exit_code: 127,
                stdout: String::new(),
                stderr: format!("failed to spawn step: {err}"),
                duration,
            },
        }
    }

    /// Run a step and stream stdout/stderr chunks to `log_tx` while the process runs.
    pub async fn run_step_streaming(
        &self,
        workspace: &Path,
        index: usize,
        step: &Step,
        job_env: &[(&str, String)],
        log_tx: Option<mpsc::UnboundedSender<String>>,
    ) -> StepOutput {
        let name = step
            .name
            .clone()
            .unwrap_or_else(|| format!("step-{index}"));
        let cwd = step
            .working_directory
            .as_ref()
            .map(|rel| workspace.join(rel))
            .unwrap_or_else(|| workspace.to_path_buf());

        let started = Instant::now();
        let mut command = Command::new(&self.shell);
        command
            .arg("-lc")
            .arg(self.shell_invocation(&step.run))
            .current_dir(cwd)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .env("CI", "true")
            .env("PERTISK_CI", "true")
            .env("PYTHONUNBUFFERED", "1");

        for (key, value) in job_env {
            command.env(key, value);
        }

        for (key, value) in &step.env {
            command.env(key, value);
        }

        let mut child = match command.spawn() {
            Ok(child) => child,
            Err(err) => {
                return StepOutput {
                    name,
                    exit_code: 127,
                    stdout: String::new(),
                    stderr: format!("failed to spawn step: {err}"),
                    duration: started.elapsed(),
                };
            }
        };

        let (chunk_tx, mut chunk_rx) = mpsc::unbounded_channel();
        if let Some(stdout) = child.stdout.take() {
            let tx = chunk_tx.clone();
            tokio::spawn(async move {
                pipe_reader(stdout, tx).await;
            });
        }
        if let Some(stderr) = child.stderr.take() {
            let tx = chunk_tx.clone();
            tokio::spawn(async move {
                pipe_reader(stderr, tx).await;
            });
        }
        drop(chunk_tx);

        let forward = async {
            let mut combined = String::new();
            while let Some(chunk) = chunk_rx.recv().await {
                if let Some(ref log_tx) = log_tx {
                    let _ = log_tx.send(chunk.clone());
                }
                combined.push_str(&chunk);
            }
            combined
        };

        let (combined, status) = tokio::join!(forward, child.wait());

        let duration = started.elapsed();
        let exit_code = match status {
            Ok(status) => status.code().unwrap_or(1),
            Err(err) => {
                return StepOutput {
                    name,
                    exit_code: 127,
                    stdout: combined,
                    stderr: format!("failed to wait for step: {err}"),
                    duration,
                };
            }
        };

        StepOutput {
            name,
            exit_code,
            stdout: combined,
            stderr: String::new(),
            duration,
        }
    }
}

async fn pipe_reader(mut reader: impl AsyncReadExt + Unpin, tx: mpsc::UnboundedSender<String>) {
    let mut buf = [0u8; 4096];
    loop {
        match reader.read(&mut buf).await {
            Ok(0) => break,
            Ok(n) => {
                let chunk = String::from_utf8_lossy(&buf[..n]).into_owned();
                if tx.send(chunk).is_err() {
                    break;
                }
            }
            Err(_) => break,
        }
    }
}

impl JobExecutor for ShellExecutor {
    async fn execute_steps(
        &self,
        job_name: &str,
        workspace: &Path,
        steps: &[Step],
        queue_wait: Duration,
        job_env: &[(&str, String)],
    ) -> (JobMetrics, Vec<StepOutput>) {
        let mut outputs = Vec::with_capacity(steps.len());
        let mut timings = Vec::with_capacity(steps.len());

        for (index, step) in steps.iter().enumerate() {
            if step.run.trim().is_empty() {
                let name = step
                    .name
                    .clone()
                    .or_else(|| step.uses.clone())
                    .unwrap_or_else(|| format!("step-{index}"));
                outputs.push(StepOutput {
                    name,
                    exit_code: 0,
                    stdout: "skipped (no run script)".into(),
                    stderr: String::new(),
                    duration: Duration::ZERO,
                });
                continue;
            }

            let started_at = Utc::now();
            let output = self.run_step(workspace, index, step, job_env).await;
            let finished_at = Utc::now();
            timings.push(StepTiming {
                name: output.name.clone(),
                duration_ms: output.duration.as_millis() as u64,
                exit_code: output.exit_code,
                started_at,
                finished_at,
            });
            let failed = output.exit_code != 0;
            outputs.push(output);
            if failed {
                break;
            }
        }

        let metrics = JobMetrics::from_step_timings(job_name, timings, queue_wait);
        (metrics, outputs)
    }
}

pub async fn bench_noop_steps(
    executor: &ShellExecutor,
    workspace: &Path,
    iterations: u32,
) -> crate::metrics::RunnerBenchReport {
    let mut durations = Vec::with_capacity(iterations as usize);

    for _ in 0..iterations {
        let step = Step {
            name: Some("noop".into()),
            run: "true".into(),
            uses: None,
            working_directory: None,
            env: Default::default(),
            with: Default::default(),
        };
        let output = executor.run_step(workspace, 0, &step, &[]).await;
        durations.push(output.duration.as_millis() as u64);
    }

    durations.sort_unstable();
    let p50 = percentile(&durations, 50);
    let p95 = percentile(&durations, 95);
    let max = *durations.last().unwrap_or(&0);

    let spawn_start = Instant::now();
    let _ = Command::new(&executor.shell)
        .arg("-lc")
        .arg("true")
        .current_dir(workspace)
        .output()
        .await;
    let shell_spawn_overhead_ms = spawn_start.elapsed().as_millis() as u64;

    crate::metrics::RunnerBenchReport {
        iterations,
        noop_step_ms_p50: p50,
        noop_step_ms_p95: p95,
        noop_step_ms_max: max,
        shell_spawn_overhead_ms,
    }
}

fn percentile(sorted: &[u64], pct: u8) -> u64 {
    if sorted.is_empty() {
        return 0;
    }
    let idx = ((sorted.len() as f64) * (pct as f64 / 100.0)).ceil() as usize;
    sorted[idx.saturating_sub(1).min(sorted.len() - 1)]
}
