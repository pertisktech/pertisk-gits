use std::path::Path;
use std::time::Instant;

use chrono::Utc;
use pertisk_cicd::metrics::{JobMetrics, StepTiming};
use pertisk_cicd::{ShellExecutor, StepOutput};
use tempfile::TempDir;

use crate::api::{PollJobResponse, RunnerApi};
use crate::artifacts::{upload_artifact_step, upload_declared_artifact};
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
    let mut failed = false;

    for (index, step) in job.steps.iter().enumerate() {
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
            let upload_result = upload_artifact_step(api, job.job_id, &workspace, &name, &rel_path).await;
            let finished_at = Utc::now();
            let (exit_code, log_body) = match upload_result {
                Ok(()) => (0, format!("uploaded artifact {name} from {rel_path}\n")),
                Err(err) => (1, format!("artifact upload failed: {err:#}\n")),
            };
            let step_name = step
                .name
                .clone()
                .unwrap_or_else(|| format!("upload-artifact-{index}"));
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

        let started_at = Utc::now();
        let output = executor
            .run_step(&workspace, index, step, &job_env)
            .await;
        let finished_at = Utc::now();
        timings.push(StepTiming {
            name: output.name.clone(),
            duration_ms: output.duration.as_millis() as u64,
            exit_code: output.exit_code,
            started_at,
            finished_at,
        });
        api.append_log(job.job_id, &format_step_log(&output))
            .await?;
        if output.exit_code != 0 {
            failed = true;
            break;
        }
    }

    if !failed {
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
    let status = if failed { "failure" } else { "success" };
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

fn format_step_log(output: &StepOutput) -> String {
    let mut log = format!("=== {} (exit {})\n", output.name, output.exit_code);
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
    log
}
