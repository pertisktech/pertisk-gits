use std::path::Path;

use anyhow::Context;

use crate::config::repo_disk_path;

pub fn init_bare_repo(root: &Path, org_slug: &str, repo_slug: &str) -> anyhow::Result<()> {
    let path = repo_disk_path(root, org_slug, repo_slug);
    if path.exists() {
        return Ok(());
    }

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("create repo parent {}", parent.display()))?;
    }

    let status = std::process::Command::new("git")
        .args(["init", "--bare", path.to_str().unwrap_or_default()])
        .status()
        .context("spawn git init --bare")?;

    if !status.success() {
        anyhow::bail!("git init --bare failed with {status}");
    }

    Ok(())
}

pub async fn ensure_bare_repo(root: &Path, org_slug: &str, repo_slug: &str) -> anyhow::Result<()> {
    let path = repo_disk_path(root, org_slug, repo_slug);
    if path.join("HEAD").exists() {
        return Ok(());
    }
    init_bare_repo(root, org_slug, repo_slug)
}

pub fn repo_exists_on_disk(root: &Path, org_slug: &str, repo_slug: &str) -> bool {
    repo_disk_path(root, org_slug, repo_slug).join("HEAD").exists()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn init_and_exists_round_trip() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        assert!(!repo_exists_on_disk(root, "acme", "widget"));
        init_bare_repo(root, "acme", "widget").unwrap();
        assert!(repo_exists_on_disk(root, "acme", "widget"));
        // idempotent
        init_bare_repo(root, "acme", "widget").unwrap();
    }

    #[tokio::test]
    async fn ensure_bare_repo_creates_repository() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        ensure_bare_repo(root, "org", "repo").await.unwrap();
        assert!(repo_exists_on_disk(root, "org", "repo"));
        ensure_bare_repo(root, "org", "repo").await.unwrap();
    }
}
