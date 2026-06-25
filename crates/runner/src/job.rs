use std::path::Path;
use std::time::{Duration, Instant};

use chrono::Utc;
use pertisk_cicd::metrics::{JobMetrics, StepTiming};
use pertisk_cicd::ShellExecutor;
use tempfile::TempDir;
use tokio::sync::{mpsc, watch};
use tokio::task::JoinHandle;

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
        "running job"
    );
    let queued_at = Instant::now();

    api.start_job(job.job_id).await?;

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

    let mut timings = Vec::with_capacity(job.steps.len());
    let mut cancelled = false;
    let mut failed = false;

    for (index, step) in job.steps.iter().enumerate() {
        let step_name = step.name.clone().unwrap_or_else(|| {
            if step.uses.as_deref() == Some("upload-artifact") {
                format!("upload-artifact-{index}")
            } else {
                format!("step-{index}")
            }
        });

        if let Ok(control) = api.fetch_job_control(job.job_id).await {
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

        api.append_log(
            job.job_id,
            &format!("=== {step_name} (running)\n"),
        )
        .await?;

        let (cancel_tx, cancel_rx) = watch::channel(false);
        let poll_api = api.clone_for_poll();
        let poll_job_id = job.job_id;
        let poll_step = step_name.clone();
        let poll_handle: JoinHandle<()> = tokio::spawn(async move {
            poll_cancel_signals(&poll_api, poll_job_id, poll_step, cancel_tx).await;
        });

        let (log_tx, mut log_rx) = mpsc::unbounded_channel::<String>();
        let mut streamer = LogStreamer::new(api, job.job_id);
        let drain_logs = async {
            while let Some(chunk) = log_rx.recv().await {
                streamer.push(&chunk).await;
            }
            streamer.flush().await;
        };

        let started_at = Utc::now();
        let output = tokio::join!(
            drain_logs,
            executor.run_step_streaming_cancellable(
                &workspace,
                index,
                step,
                &job_env,
                Some(log_tx),
                cancel_rx.clone(),
            ),
        )
        .1;
        poll_handle.abort();
        let finished_at = Utc::now();

        let step_cancelled = output.exit_code == 130;
        let exit_label = if step_cancelled {
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

    if !failed && !cancelled {
        for artifact in &job.artifacts {
            if let Err(err) = upload_declared_artifact(api, job.job_id, &workspace, artifact).await {
                failed = true;
                api.append_log(
                    job.job_id,
                    &format!("=== artifact {} (exit 1)\nartifact upload failed: {err:#}\n", artifact.name),
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
    let status = if cancelled {
        "cancelled"
    } else if failed {
        "failure"
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

async fn poll_cancel_signals(
    api: &RunnerApi,
    job_id: uuid::Uuid,
    step_name: String,
    cancel_tx: watch::Sender<bool>,
) {
    loop {
        tokio::time::sleep(Duration::from_millis(500)).await;
        let Ok(control) = api.fetch_job_control(job_id).await else {
            continue;
        };
        if control.should_cancel_step(&step_name) {
            let _ = cancel_tx.send(true);
            return;
        }
    }
}

impl RunnerApi {
    pub fn clone_for_poll(&self) -> Self {
        Self {
            client: self.client.clone(),
            base_url: self.base_url.clone(),
            token: self.token.clone(),
        }
    }
}
