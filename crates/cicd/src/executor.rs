use std::path::Path;
use std::time::{Duration, Instant};

use chrono::Utc;
use tokio::process::Command;

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

    async fn run_step(&self, workspace: &Path, index: usize, step: &Step) -> StepOutput {
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
            .arg(&step.run)
            .current_dir(cwd)
            .env("CI", "true")
            .env("PERTISK_CI", "true");

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
}

impl JobExecutor for ShellExecutor {
    async fn execute_steps(
        &self,
        job_name: &str,
        workspace: &Path,
        steps: &[Step],
        queue_wait: Duration,
    ) -> (JobMetrics, Vec<StepOutput>) {
        let mut outputs = Vec::with_capacity(steps.len());
        let mut timings = Vec::with_capacity(steps.len());

        for (index, step) in steps.iter().enumerate() {
            let started_at = Utc::now();
            let output = self.run_step(workspace, index, step).await;
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
            working_directory: None,
            env: Default::default(),
        };
        let output = executor.run_step(workspace, 0, &step).await;
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
