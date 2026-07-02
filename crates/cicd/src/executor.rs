use std::path::Path;
use std::process::Stdio;
use std::time::{Duration, Instant};

use chrono::Utc;
use tokio::io::AsyncReadExt;
use tokio::process::Command;
use tokio::sync::{mpsc, watch};

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

    fn command_for_script(&self, script: &str) -> Command {
        let mut command = Command::new(&self.shell);
        command.arg("-c").arg(wrap_script_for_process_group(script));
        configure_process_group(&mut command);
        command
    }

    fn apply_step_env(
        command: &mut Command,
        job_env: &[(&str, String)],
        step_env: &std::collections::HashMap<String, String>,
    ) {
        command
            .env("CI", "true")
            .env("PERTISK_CI", "true")
            .env("PYTHONUNBUFFERED", "1");
        for (key, value) in job_env {
            command.env(key, value);
        }
        for (key, value) in step_env {
            command.env(key, value);
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

        let mut command = self.command_for_script(&step.run);
        command.current_dir(cwd);
        Self::apply_step_env(&mut command, job_env, &step.env);

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
        let (_tx, rx) = watch::channel(false);
        self.run_step_streaming_cancellable(workspace, index, step, job_env, log_tx, rx)
            .await
    }

    /// Like [`run_step_streaming`] but kills the step when `cancel` becomes true.
    pub async fn run_step_streaming_cancellable(
        &self,
        workspace: &Path,
        index: usize,
        step: &Step,
        job_env: &[(&str, String)],
        log_tx: Option<mpsc::UnboundedSender<String>>,
        mut cancel: watch::Receiver<bool>,
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
        let mut command = self.command_for_script(&step.run);
        command
            .current_dir(cwd)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        Self::apply_step_env(&mut command, job_env, &step.env);

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

        let mut forward = Box::pin(forward);
        let mut was_cancelled = false;
        let (combined, status) = loop {
            if *cancel.borrow() {
                was_cancelled = true;
                kill_step_child(&mut child).await;
                let combined = forward.as_mut().await;
                break (combined, child.wait().await);
            }

            tokio::select! {
                biased;
                changed = cancel.changed() => {
                    if changed.is_err() || *cancel.borrow() {
                        was_cancelled = true;
                        kill_step_child(&mut child).await;
                        let combined = forward.as_mut().await;
                        break (combined, child.wait().await);
                    }
                }
                combined = forward.as_mut() => {
                    break (combined, child.wait().await);
                }
            }
        };

        let duration = started.elapsed();
        if was_cancelled {
            return StepOutput {
                name,
                exit_code: 130,
                stdout: combined,
                stderr: "step cancelled".into(),
                duration,
            };
        }

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

/// Forward TERM/INT to the whole step subtree (npm/jest workers, etc.).
fn wrap_script_for_process_group(script: &str) -> String {
    #[cfg(unix)]
    {
        format!("trap 'kill 0' TERM INT; {script}")
    }
    #[cfg(not(unix))]
    {
        script.to_string()
    }
}

fn configure_process_group(command: &mut Command) {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.as_std_mut().process_group(0);
    }
}

async fn kill_step_child(child: &mut tokio::process::Child) {
    #[cfg(unix)]
    {
        if let Some(pid) = child.id() {
            let pgid = pid as i32;
            unsafe {
                libc::killpg(pgid, libc::SIGTERM);
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
            unsafe {
                libc::killpg(pgid, libc::SIGKILL);
            }
        }
    }
    #[cfg(not(unix))]
    {
        let _ = child.kill().await;
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::Step;
    use tempfile::TempDir;

    #[test]
    fn percentile_empty_returns_zero() {
        assert_eq!(percentile(&[], 50), 0);
    }

    #[test]
    fn percentile_picks_expected_index() {
        let data = vec![10, 20, 30, 40, 100];
        assert_eq!(percentile(&data, 50), 30);
        assert_eq!(percentile(&data, 95), 100);
    }

    #[tokio::test]
    async fn execute_steps_runs_echo() {
        let executor = ShellExecutor::new();
        let tmp = TempDir::new().unwrap();
        let step = Step {
            name: Some("echo".into()),
            run: "echo hello".into(),
            uses: None,
            working_directory: None,
            env: Default::default(),
            with: Default::default(),
        };
        let (metrics, outputs) = executor
            .execute_steps("job", tmp.path(), &[step], Duration::ZERO, &[])
            .await;
        assert_eq!(outputs.len(), 1);
        assert_eq!(outputs[0].exit_code, 0);
        assert!(outputs[0].stdout.contains("hello"));
        assert_eq!(metrics.job_name, "job");
    }

    #[tokio::test]
    async fn execute_steps_skips_empty_run() {
        let executor = ShellExecutor::new();
        let tmp = TempDir::new().unwrap();
        let step = Step {
            name: Some("noop".into()),
            run: "   ".into(),
            uses: Some("actions/cache@v4".into()),
            working_directory: None,
            env: Default::default(),
            with: Default::default(),
        };
        let (_, outputs) = executor
            .execute_steps("job", tmp.path(), &[step], Duration::ZERO, &[])
            .await;
        assert_eq!(outputs.len(), 1);
        assert_eq!(outputs[0].exit_code, 0);
        assert!(outputs[0].stdout.contains("skipped"));
    }

    #[tokio::test]
    async fn execute_steps_stops_on_failure() {
        let executor = ShellExecutor::new();
        let tmp = TempDir::new().unwrap();
        let steps = [
            Step {
                name: Some("fail".into()),
                run: "exit 42".into(),
                uses: None,
                working_directory: None,
                env: Default::default(),
                with: Default::default(),
            },
            Step {
                name: Some("never".into()),
                run: "echo should-not-run".into(),
                uses: None,
                working_directory: None,
                env: Default::default(),
                with: Default::default(),
            },
        ];
        let (_, outputs) = executor
            .execute_steps("job", tmp.path(), &steps, Duration::ZERO, &[])
            .await;
        assert_eq!(outputs.len(), 1);
        assert_eq!(outputs[0].exit_code, 42);
    }

    #[tokio::test]
    async fn run_step_honors_working_directory_and_env() {
        let executor = ShellExecutor::new();
        let tmp = TempDir::new().unwrap();
        std::fs::create_dir_all(tmp.path().join("sub")).unwrap();
        let mut env = std::collections::HashMap::new();
        env.insert("GREETING".into(), "hi".into());
        let step = Step {
            name: Some("cwd".into()),
            run: "pwd && echo $GREETING".into(),
            uses: None,
            working_directory: Some("sub".into()),
            env,
            with: Default::default(),
        };
        let output = executor
            .run_step(tmp.path(), 0, &step, &[("CI_JOB_NAME", "cwd".into())])
            .await;
        assert_eq!(output.exit_code, 0);
        assert!(output.stdout.contains("sub"));
        assert!(output.stdout.contains("hi"));
    }

    #[tokio::test]
    async fn run_step_streaming_forwards_output() {
        let executor = ShellExecutor::new();
        let tmp = TempDir::new().unwrap();
        let step = Step {
            name: Some("stream".into()),
            run: "echo streamed".into(),
            uses: None,
            working_directory: None,
            env: Default::default(),
            with: Default::default(),
        };
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        let output = executor
            .run_step_streaming(tmp.path(), 0, &step, &[], Some(tx))
            .await;
        assert_eq!(output.exit_code, 0);
        assert!(output.stdout.contains("streamed"));
        assert!(rx.recv().await.unwrap().contains("streamed"));
    }

    #[tokio::test]
    async fn run_step_streaming_cancellable() {
        let executor = ShellExecutor::new();
        let tmp = TempDir::new().unwrap();
        let step = Step {
            name: Some("sleep".into()),
            run: "sleep 30".into(),
            uses: None,
            working_directory: None,
            env: Default::default(),
            with: Default::default(),
        };
        let (cancel_tx, cancel_rx) = watch::channel(false);
        let handle = tokio::spawn({
            let executor = executor.clone();
            async move {
                executor
                    .run_step_streaming_cancellable(tmp.path(), 0, &step, &[], None, cancel_rx)
                    .await
            }
        });
        tokio::time::sleep(Duration::from_millis(100)).await;
        let _ = cancel_tx.send(true);
        let output = handle.await.unwrap();
        assert_eq!(output.exit_code, 130);
        assert!(output.stderr.contains("cancelled"));
    }

    #[tokio::test]
    async fn run_step_streaming_without_log_sink() {
        let executor = ShellExecutor::new();
        let tmp = TempDir::new().unwrap();
        let step = Step {
            name: Some("stream".into()),
            run: "echo quiet".into(),
            uses: None,
            working_directory: None,
            env: Default::default(),
            with: Default::default(),
        };
        let output = executor
            .run_step_streaming(tmp.path(), 0, &step, &[], None)
            .await;
        assert_eq!(output.exit_code, 0);
        assert!(output.stdout.contains("quiet"));
    }

    #[tokio::test]
    async fn execute_steps_records_step_timings() {
        let executor = ShellExecutor::new();
        let tmp = TempDir::new().unwrap();
        let step = Step {
            name: Some("timed".into()),
            run: "echo timed".into(),
            uses: None,
            working_directory: None,
            env: Default::default(),
            with: Default::default(),
        };
        let (metrics, _) = executor
            .execute_steps("timed-job", tmp.path(), &[step], Duration::from_millis(5), &[])
            .await;
        assert_eq!(metrics.job_name, "timed-job");
        assert_eq!(metrics.steps.len(), 1);
        assert_eq!(metrics.steps[0].name, "timed");
    }

    #[tokio::test]
    async fn bench_noop_steps_collects_metrics() {
        let executor = ShellExecutor::new();
        let tmp = TempDir::new().unwrap();
        let report = bench_noop_steps(&executor, tmp.path(), 3).await;
        assert_eq!(report.iterations, 3);
        assert!(report.noop_step_ms_p50 > 0);
    }

    #[tokio::test]
    async fn run_step_spawn_failure_uses_exit_127() {
        let executor = ShellExecutor {
            shell: "/definitely/missing/shell".into(),
        };
        let tmp = TempDir::new().unwrap();
        let step = Step {
            name: Some("bad".into()),
            run: "echo nope".into(),
            uses: None,
            working_directory: None,
            env: Default::default(),
            with: Default::default(),
        };
        let output = executor.run_step(tmp.path(), 0, &step, &[]).await;
        assert_eq!(output.exit_code, 127);
        assert!(output.stderr.contains("failed to spawn"));
    }
}
