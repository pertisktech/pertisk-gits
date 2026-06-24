use std::path::Path;
use std::process::Stdio;

use anyhow::Context;
use tokio::process::Command;

use crate::api::RunnerApi;

pub async fn materialize_workspace(
    api: &RunnerApi,
    job_id: uuid::Uuid,
    repos_root: Option<&Path>,
    org_slug: &str,
    repo_slug: &str,
    commit_sha: &str,
    workspace: &Path,
) -> anyhow::Result<()> {
    if let Some(root) = repos_root {
        if pertisk_git::repo_exists_on_disk(root, org_slug, repo_slug) {
            let repo_path = pertisk_git::config::repo_disk_path(root, org_slug, repo_slug);
            tracing::debug!(path = %repo_path.display(), "checking out from local bare repo");
            return pertisk_git::workspace::checkout_commit(&repo_path, commit_sha, workspace).await;
        }
        let repo_path = pertisk_git::config::repo_disk_path(root, org_slug, repo_slug);
        tracing::info!(
            repo = %format!("{org_slug}/{repo_slug}"),
            path = %repo_path.display(),
            "local bare repo not found; fetching workspace from API"
        );
    } else {
        tracing::info!(
            repo = %format!("{org_slug}/{repo_slug}"),
            "PERTISK_REPOS_ROOT unset; fetching workspace from API"
        );
    }

    extract_workspace_archive(api.download_workspace(job_id).await?, workspace).await
}

async fn extract_workspace_archive(bytes: bytes::Bytes, workspace: &Path) -> anyhow::Result<()> {
    tokio::fs::create_dir_all(workspace)
        .await
        .with_context(|| format!("create workspace {}", workspace.display()))?;

    let mut child = Command::new("tar")
        .args(["xzf", "-", "-C"])
        .arg(workspace)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .context("spawn tar")?;

    let mut stdin = child.stdin.take().context("tar stdin not available")?;
    tokio::io::AsyncWriteExt::write_all(&mut stdin, &bytes)
        .await
        .context("write tar stdin")?;
    drop(stdin);

    let output = child.wait_with_output().await.context("tar extract")?;
    if !output.status.success() {
        anyhow::bail!(
            "tar extract failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    let mut entries = tokio::fs::read_dir(workspace).await.context("read workspace")?;
    if entries.next_entry().await?.is_none() {
        anyhow::bail!("API workspace was empty after extract");
    }

    Ok(())
}
