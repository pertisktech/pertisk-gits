use std::path::{Path, PathBuf};

use anyhow::Context;

use crate::config::repo_disk_path;

/// Bare repos with packed refs may have no files under `refs/heads` or `refs/tags`.
/// Git still requires those directories; backup tar archives omit empty dirs.
pub fn ensure_bare_repo_refs_dirs(repo_path: &Path) -> std::io::Result<()> {
    if !repo_path.join("HEAD").is_file() {
        return Ok(());
    }
    std::fs::create_dir_all(repo_path.join("refs/heads"))?;
    std::fs::create_dir_all(repo_path.join("refs/tags"))?;
    Ok(())
}

pub fn repair_all_bare_repo_refs_dirs(repos_root: &Path) -> anyhow::Result<usize> {
    let mut repaired = 0_usize;
    for repo_path in find_bare_repo_paths(repos_root)? {
        let needs_heads = !repo_path.join("refs/heads").is_dir();
        let needs_tags = !repo_path.join("refs/tags").is_dir();
        if needs_heads || needs_tags {
            ensure_bare_repo_refs_dirs(&repo_path)?;
            repaired += 1;
        }
    }
    Ok(repaired)
}

fn find_bare_repo_paths(root: &Path) -> anyhow::Result<Vec<PathBuf>> {
    let mut repos = Vec::new();
    if !root.is_dir() {
        return Ok(repos);
    }
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let mut entries: Vec<PathBuf> = std::fs::read_dir(&dir)?
            .filter_map(|entry| entry.ok().map(|e| e.path()))
            .collect();
        entries.sort();
        for path in entries {
            if !path.is_dir() {
                continue;
            }
            if path
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.ends_with(".git"))
                && path.join("HEAD").is_file()
            {
                repos.push(path);
                continue;
            }
            stack.push(path);
        }
    }
    Ok(repos)
}

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

    #[test]
    fn ensure_refs_dirs_on_packed_bare_repo() {
        let tmp = TempDir::new().unwrap();
        let repo = tmp.path().join("acme.git");
        std::fs::create_dir_all(repo.join("objects/pack")).unwrap();
        std::fs::write(repo.join("HEAD"), "ref: refs/heads/main\n").unwrap();
        std::fs::write(repo.join("packed-refs"), "^a0b1c2 refs/heads/main\n").unwrap();
        assert!(!repo.join("refs/heads").is_dir());

        ensure_bare_repo_refs_dirs(&repo).unwrap();
        assert!(repo.join("refs/heads").is_dir());
        assert!(repo.join("refs/tags").is_dir());
    }
}
