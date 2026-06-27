use std::path::Path;

use anyhow::{Context, Result};
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

use crate::explorer;

#[derive(Debug, Clone)]
pub struct FileChange {
    pub path: String,
    /// `None` removes the file; `Some` sets blob content (create or update).
    pub content: Option<String>,
}

#[derive(Debug, Clone)]
pub struct CommitAuthor {
    pub name: String,
    pub email: String,
}

/// Apply `changes` on `branch` in a bare repository and return the new commit SHA.
pub async fn commit_files(
    repo_path: &Path,
    branch: &str,
    author: &CommitAuthor,
    message: &str,
    changes: &[FileChange],
) -> Result<String> {
    if changes.is_empty() {
        anyhow::bail!("no file changes provided");
    }

    if !explorer::ref_exists(repo_path, branch).await? {
        anyhow::bail!("branch '{branch}' not found");
    }

    for change in changes {
        validate_path(&change.path)?;
        if let Some(content) = &change.content {
            if content.bytes().any(|b| b == 0) {
                anyhow::bail!("binary content is not supported for path '{}'", change.path);
            }
        }
    }

    let branch_ref = format!("refs/heads/{branch}");
    let parent_sha = git(repo_path, None, &["rev-parse", &branch_ref]).await?;

    let temp_dir = tempfile::tempdir().context("create temp dir for git index")?;
    let index_file = temp_dir.path().join("index");

    git(
        repo_path,
        Some(&index_file),
        &["read-tree", &parent_sha],
    )
    .await?;

    for change in changes {
        if let Some(content) = &change.content {
            let blob_sha = hash_object(repo_path, content.as_bytes()).await?;
            git(
                repo_path,
                Some(&index_file),
                &[
                    "update-index",
                    "--add",
                    "--cacheinfo",
                    "100644",
                    &blob_sha,
                    &change.path,
                ],
            )
            .await?;
        } else {
            git(
                repo_path,
                Some(&index_file),
                &["update-index", "--force-remove", "--", &change.path],
            )
            .await?;
        }
    }

    let tree_sha = git(repo_path, Some(&index_file), &["write-tree"]).await?;

    let commit_sha = {
        let output = Command::new("git")
            .arg(format!("--git-dir={}", repo_path.display()))
            .args([
                "-c",
                &format!("user.name={}", author.name),
                "-c",
                &format!("user.email={}", author.email),
            ])
            .args(["commit-tree", &tree_sha, "-p", &parent_sha, "-m", message])
            .output()
            .await
            .context("spawn git commit-tree")?;

        if !output.status.success() {
            anyhow::bail!(
                "git commit-tree failed: {}",
                String::from_utf8_lossy(&output.stderr)
            );
        }

        String::from_utf8_lossy(&output.stdout).trim().to_string()
    };

    if commit_sha.is_empty() {
        anyhow::bail!("git commit-tree returned empty SHA");
    }

    git(
        repo_path,
        None,
        &["update-ref", &branch_ref, &commit_sha, &parent_sha],
    )
    .await?;

    Ok(commit_sha)
}

fn validate_path(path: &str) -> Result<()> {
    if path.is_empty() || path.starts_with('/') || path.contains('\\') {
        anyhow::bail!("invalid path '{path}'");
    }

    for part in path.split('/') {
        if part.is_empty() || part == "." || part == ".." {
            anyhow::bail!("invalid path '{path}'");
        }
    }

    Ok(())
}

async fn hash_object(repo_path: &Path, content: &[u8]) -> Result<String> {
    let mut child = Command::new("git")
        .arg(format!("--git-dir={}", repo_path.display()))
        .args(["hash-object", "-w", "--stdin"])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .spawn()
        .context("spawn git hash-object")?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(content).await.context("write blob stdin")?;
    }

    let output = child.wait_with_output().await.context("git hash-object")?;
    if !output.status.success() {
        anyhow::bail!(
            "git hash-object failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    let sha = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if sha.is_empty() {
        anyhow::bail!("git hash-object returned empty SHA");
    }

    Ok(sha)
}

async fn git(repo_path: &Path, index_file: Option<&Path>, args: &[&str]) -> Result<String> {
    let mut command = Command::new("git");
    command
        .arg(format!("--git-dir={}", repo_path.display()))
        .args(["-c", "safe.directory=*"]);

    if let Some(index_file) = index_file {
        command.env("GIT_INDEX_FILE", index_file);
    }

    command.args(args);

    let output = command
        .output()
        .await
        .with_context(|| format!("spawn git {}", args.first().copied().unwrap_or("")))?;

    if !output.status.success() {
        anyhow::bail!(
            "git {} failed: {}",
            args.first().copied().unwrap_or(""),
            String::from_utf8_lossy(&output.stderr)
        );
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_path_rejects_traversal() {
        assert!(validate_path("../secret").is_err());
        assert!(validate_path("src/../main.rs").is_err());
        assert!(validate_path("/etc/passwd").is_err());
    }

    #[test]
    fn validate_path_accepts_normal_paths() {
        assert!(validate_path("README.md").is_ok());
        assert!(validate_path("src/main.rs").is_ok());
    }
}
