use std::path::Path;
use std::time::{Duration, Instant};

use chrono::Utc;
use pertisk_cicd::apply_secrets_to_step;
use pertisk_cicd::metrics::{JobMetrics, StepTiming};
use pertisk_cicd::ShellExecutor;
use tempfile::TempDir;
use tokio::sync::{mpsc, watch};
use tokio::task::JoinHandle;

use super::common::{build_job_env, prepare_secrets};
use crate::api::{PollJobResponse, RunnerApi};
use crate::artifacts::{upload_artifact_step, upload_declared_artifact};
use crate::log_stream::LogStreamer;
use crate::workspace::materialize_workspace;

pub async fn run_job(
    api: &RunnerApi,
    job: PollJobResponse,
    repos_root: Option<&Path>,
) -> anyhow::Result<()> {
    tracing::info!(
        job = %job.job_name,
        repo = %format!("{}/{}", job.org_slug, job.repo_slug),
        timeout_minutes = ?job.timeout_minutes,
        executor = "shell",
        "running job"
    );
    let queued_at = Instant::now();

    api.start_job(job.job_id).await?;

    let job_timeout = job
        .timeout_minutes
        .map(|minutes| Duration::from_secs(u64::from(minutes) * 60));
    let job_started = Instant::now();

    let work_root = TempDir::with_prefix("pertisk-ci-")?;
    let workspace = work_root.path().join(&job.repo_slug);
    if let Err(err) = materialize_workspace(
        api,
        job.job_id,
        repos_root,
        &job.org_slug,
        &job.repo_slug,
        &job.commit_sha,
        &workspace,
    )
    .await
    {
        api.complete_job(
            job.job_id,
            "failure",
            Some(&format!("checkout failed: {err:#}")),
            None,
        )
        .await?;
        return Ok(());
    }

    let secrets = prepare_secrets(api, &job, work_root.path()).await?;

    let executor = ShellExecutor::new();
    let queue_wait = queued_at.elapsed();
    let job_env_owned = build_job_env(&secrets.injection, &workspace.display().to_string());
    let job_env: Vec<(&str, String)> = job_env_owned
        .iter()
        .map(|(key, value)| (key.as_str(), value.clone()))
        .collect();

    let mut timings = Vec::with_capacity(job.steps.len());
    let mut cancelled = false;
    let mut timed_out = false;
    let mut failed = false;

    for (index, step) in job.steps.iter().enumerate() {
        if job_timed_out(job_started, job_timeout) || job_timed_out_remote(api, job.job_id).await {
            timed_out = true;
            let minutes = job.timeout_minutes.unwrap_or(0);
            api.append_log(
                job.job_id,
                &format!("\n=== job timed out after {minutes} minutes\n"),
            )
            .await?;
            break;
        }

        let step_name = step.name.clone().unwrap_or_else(|| {
            if step.uses.as_deref() == Some("upload-artifact") {
                format!("upload-artifact-{index}")
            } else {
                format!("step-{index}")
            }
        });

        if let Ok(control) = api.fetch_job_control(job.job_id).await {
            if control.timed_out {
                timed_out = true;
                let minutes = job.timeout_minutes.unwrap_or(0);
                api.append_log(
                    job.job_id,
                    &format!("\n=== job timed out after {minutes} minutes\n"),
                )
                .await?;
                break;
            }
            if control.should_cancel_job() {
                cancelled = true;
                api.append_log(job.job_id, "=== job cancelled\n").await?;
                break;
            }
            if control.should_cancel_step(&step_name) {
                cancelled = true;
                api.append_log(job.job_id, &format!("=== {step_name} cancelled\n"))
                    .await?;
                break;
            }
        }

        if step.uses.as_deref() == Some("upload-artifact") {
            let name = step
                .with
                .get("name")
                .cloned()
                .unwrap_or_else(|| "artifact".into());
            let rel_path = step
                .with
                .get("path")
                .cloned()
                .unwrap_or_else(|| name.clone());
            let started_at = Utc::now();
            let upload_result =
                upload_artifact_step(api, job.job_id, &workspace, &name, &rel_path).await;
            let finished_at = Utc::now();
            let (exit_code, log_body) = match upload_result {
                Ok(()) => (0, format!("uploaded artifact {name} from {rel_path}\n")),
                Err(err) => (1, format!("artifact upload failed: {err:#}\n")),
            };
            timings.push(StepTiming {
                name: step_name.clone(),
                duration_ms: finished_at
                    .signed_duration_since(started_at)
                    .num_milliseconds()
                    .max(0) as u64,
                exit_code,
                started_at,
                finished_at,
            });
            api.append_log(job.job_id, &format!("=== {step_name} (exit {exit_code})\n{log_body}"))
                .await?;
            if exit_code != 0 {
                failed = true;
                break;
            }
            continue;
        }

        api.append_log(job.job_id, &format!("=== {step_name} (running)\n"))
            .await?;

        let (cancel_tx, cancel_rx) = watch::channel(false);
        let poll_api = api.clone_for_poll();
        let poll_job_id = job.job_id;
        let poll_step = step_name.clone();
        let poll_cancel_tx = cancel_tx.clone();
        let poll_handle: JoinHandle<()> = tokio::spawn(async move {
            poll_cancel_signals(&poll_api, poll_job_id, poll_step, poll_cancel_tx).await;
        });

        if let Some(timeout) = job_timeout {
            let remaining = timeout.saturating_sub(job_started.elapsed());
            if remaining.is_zero() {
                timed_out = true;
                poll_handle.abort();
                break;
            }
            let cancel_tx_timeout = cancel_tx.clone();
            tokio::spawn(async move {
                tokio::time::sleep(remaining).await;
                let _ = cancel_tx_timeout.send(true);
            });
        }

        let (log_tx, mut log_rx) = mpsc::unbounded_channel::<String>();
        let mut streamer = LogStreamer::new(api, job.job_id, secrets.mask_values.clone());
        let drain_logs = async {
            while let Some(chunk) = log_rx.recv().await {
                streamer.push(&chunk).await;
            }
            streamer.flush().await;
        };

        let started_at = Utc::now();
        let resolved_step = apply_secrets_to_step(step, &secrets.injection);
        let output = tokio::join!(
            drain_logs,
            executor.run_step_streaming_cancellable(
                &workspace,
                index,
                &resolved_step,
                &job_env,
                Some(log_tx),
                cancel_rx.clone(),
            ),
        )
        .1;
        poll_handle.abort();
        let finished_at = Utc::now();

        let step_timed_out =
            job_timed_out(job_started, job_timeout) || job_timed_out_remote(api, job.job_id).await;
        let step_cancelled = output.exit_code == 130 && !step_timed_out;
        let exit_label = if step_timed_out {
            "timed out".to_string()
        } else if step_cancelled {
            "cancelled".to_string()
        } else {
            output.exit_code.to_string()
        };
        api.append_log(
            job.job_id,
            &format!("\n=== {step_name} (exit {exit_label})\n"),
        )
        .await?;

        timings.push(StepTiming {
            name: output.name.clone(),
            duration_ms: output.duration.as_millis() as u64,
            exit_code: output.exit_code,
            started_at,
            finished_at,
        });

        if step_timed_out {
            timed_out = true;
            api.append_log(job.job_id, "=== job timed out\n").await?;
            break;
        }
        if step_cancelled {
            cancelled = true;
            api.append_log(job.job_id, "=== step cancelled by user\n")
                .await?;
            break;
        }
        if output.exit_code != 0 {
            failed = true;
            break;
        }
    }

    if !failed && !cancelled && !timed_out {
        for artifact in &job.artifacts {
            if job_timed_out(job_started, job_timeout) {
                timed_out = true;
                break;
            }
            if let Err(err) = upload_declared_artifact(api, job.job_id, &workspace, artifact).await {
                failed = true;
                api.append_log(
                    job.job_id,
                    &format!(
                        "=== artifact {} (exit 1)\nartifact upload failed: {err:#}\n",
                        artifact.name
                    ),
                )
                .await?;
                break;
            }
            api.append_log(
                job.job_id,
                &format!(
                    "=== artifact {} (exit 0)\nuploaded {} from {}\n",
                    artifact.name, artifact.name, artifact.path
                ),
            )
            .await?;
        }
    }

    let metrics = JobMetrics::from_step_timings(&job.job_name, timings, queue_wait);
    let status = if timed_out || failed {
        "failure"
    } else if cancelled {
        "cancelled"
    } else {
        "success"
    };
    let metrics_json = serde_json::to_value(&metrics).ok();
    api.complete_job(job.job_id, status, None, metrics_json).await?;
    tracing::info!(
        job = %job.job_name,
        status,
        execution_ms = metrics.execution_ms,
        "job finished"
    );
    Ok(())
}

fn job_timed_out(started: Instant, timeout: Option<Duration>) -> bool {
    timeout.is_some_and(|limit| started.elapsed() >= limit)
}

async fn job_timed_out_remote(api: &RunnerApi, job_id: uuid::Uuid) -> bool {
    api.fetch_job_control(job_id)
        .await
        .map(|control| control.timed_out)
        .unwrap_or(false)
}

async fn poll_cancel_signals(
    api: &RunnerApi,
    job_id: uuid::Uuid,
    step_name: String,
    cancel_tx: watch::Sender<bool>,
) {
    loop {
        if let Ok(control) = api.fetch_job_control(job_id).await {
            if control.timed_out || control.should_cancel_job() || control.should_cancel_step(&step_name)
            {
                let _ = cancel_tx.send(true);
                return;
            }
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
}
