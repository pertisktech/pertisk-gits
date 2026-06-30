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

    for change in changes {
        validate_path(&change.path)?;
        if let Some(content) = &change.content {
            if content.bytes().any(|b| b == 0) {
                anyhow::bail!("binary content is not supported for path '{}'", change.path);
            }
        }
    }

    let branch_ref = format!("refs/heads/{branch}");
    let branch_exists = explorer::ref_exists(repo_path, branch).await?;
    let parent_sha = if branch_exists {
        Some(git(repo_path, None, &["rev-parse", &branch_ref]).await?)
    } else {
        None
    };

    let temp_dir = tempfile::tempdir().context("create temp dir for git index")?;
    let index_file = temp_dir.path().join("index");

    if let Some(parent) = &parent_sha {
        git(
            repo_path,
            Some(&index_file),
            &["read-tree", parent],
        )
        .await?;
    } else {
        git(
            repo_path,
            Some(&index_file),
            &["read-tree", "--empty"],
        )
        .await?;
    }

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
                    &format!("100644,{blob_sha},{}", change.path),
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
        let mut command = Command::new("git");
        command
            .arg(format!("--git-dir={}", repo_path.display()))
            .args([
                "-c",
                &format!("user.name={}", author.name),
                "-c",
                &format!("user.email={}", author.email),
            ])
            .arg("commit-tree")
            .arg(&tree_sha)
            .arg("-m")
            .arg(message);
        if let Some(parent) = &parent_sha {
            command.arg("-p").arg(parent);
        }

        let output = command
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

    if let Some(parent) = &parent_sha {
        git(
            repo_path,
            None,
            &["update-ref", &branch_ref, &commit_sha, parent],
        )
        .await?;
    } else {
        git(
            repo_path,
            None,
            &["update-ref", &branch_ref, &commit_sha],
        )
        .await?;
    }

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
        .args(["-c", "safe.directory=*"])
        .args(["hash-object", "-w", "--stdin"])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .context("spawn git hash-object")?;

    {
        let mut stdin = child
            .stdin
            .take()
            .context("git hash-object stdin unavailable")?;
        stdin
            .write_all(content)
            .await
            .context("write blob stdin")?;
        stdin.shutdown().await.context("close blob stdin")?;
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
        assert!(validate_path("docs/.gitkeep").is_ok());
    }

    #[tokio::test]
    async fn commit_files_creates_nested_gitkeep_folder() {
        use std::process::Command;
        use tempfile::TempDir;

        let tmp = TempDir::new().unwrap();
        let repo_path = tmp.path().join("repo.git");
        Command::new("git")
            .args(["init", "--bare", repo_path.to_str().unwrap()])
            .output()
            .unwrap();
        let wt = tmp.path().join("wt");
        Command::new("git")
            .args(["clone", repo_path.to_str().unwrap(), wt.to_str().unwrap()])
            .output()
            .unwrap();
        Command::new("git")
            .current_dir(&wt)
            .args(["config", "user.email", "t@t.com"])
            .output()
            .unwrap();
        Command::new("git")
            .current_dir(&wt)
            .args(["config", "user.name", "T"])
            .output()
            .unwrap();
        Command::new("git")
            .current_dir(&wt)
            .args(["commit", "--allow-empty", "-m", "init"])
            .output()
            .unwrap();
        Command::new("git")
            .current_dir(&wt)
            .args(["push", "origin", "main"])
            .output()
            .unwrap();

        let author = CommitAuthor {
            name: "T".into(),
            email: "t@t.com".into(),
        };
        let sha = commit_files(
            &repo_path,
            "main",
            &author,
            "Create folder docs",
            &[FileChange {
                path: "docs/.gitkeep".into(),
                content: Some(String::new()),
            }],
        )
        .await
        .expect("commit should succeed");

        assert!(!sha.is_empty());
        let tree = Command::new("git")
            .arg(format!("--git-dir={}", repo_path.display()))
            .args(["ls-tree", "-r", "refs/heads/main"])
            .output()
            .unwrap();
        let out = String::from_utf8_lossy(&tree.stdout);
        assert!(out.contains("docs/.gitkeep"), "output: {out}");
    }

    #[tokio::test]
    async fn commit_files_creates_initial_commit_on_empty_repo() {
        use std::process::Command;
        use tempfile::TempDir;

        let tmp = TempDir::new().unwrap();
        let repo_path = tmp.path().join("repo.git");
        Command::new("git")
            .args(["init", "--bare", repo_path.to_str().unwrap()])
            .output()
            .unwrap();

        let author = CommitAuthor {
            name: "T".into(),
            email: "t@t.com".into(),
        };
        let sha = commit_files(
            &repo_path,
            "main",
            &author,
            "Create README.md",
            &[FileChange {
                path: "README.md".into(),
                content: Some("# Hello".into()),
            }],
        )
        .await
        .expect("initial commit should succeed");

        assert!(!sha.is_empty());
        let out = Command::new("git")
            .arg(format!("--git-dir={}", repo_path.display()))
            .args(["ls-tree", "-r", "refs/heads/main"])
            .output()
            .unwrap();
        let stdout = String::from_utf8_lossy(&out.stdout);
        assert!(stdout.contains("README.md"), "output: {stdout}");
    }
}
