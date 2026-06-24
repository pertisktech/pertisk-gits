use std::path::Path;

use anyhow::Context;
use pertisk_cicd::ArtifactDecl;
use tokio::process::Command;

use crate::api::RunnerApi;

pub async fn upload_declared_artifact(
    api: &RunnerApi,
    job_id: uuid::Uuid,
    workspace: &Path,
    artifact: &ArtifactDecl,
) -> anyhow::Result<()> {
    let data = archive_path(workspace, &artifact.path).await?;
    api
        .upload_artifact(job_id, &artifact.name, &artifact.path, data)
        .await
}

pub async fn upload_artifact_step(
    api: &RunnerApi,
    job_id: uuid::Uuid,
    workspace: &Path,
    name: &str,
    rel_path: &str,
) -> anyhow::Result<()> {
    let data = archive_path(workspace, rel_path).await?;
    api.upload_artifact(job_id, name, rel_path, data).await
}

pub async fn archive_path(workspace: &Path, rel_path: &str) -> anyhow::Result<Vec<u8>> {
    let full = workspace.join(rel_path);
    if !full.exists() {
        anyhow::bail!("artifact path not found: {rel_path}");
    }

    let output = Command::new("tar")
        .arg("-czf")
        .arg("-")
        .arg("-C")
        .arg(workspace)
        .arg(rel_path)
        .output()
        .await
        .context("tar artifact")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("tar failed: {stderr}");
    }

    Ok(output.stdout)
}
