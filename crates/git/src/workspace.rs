use std::path::Path;

use anyhow::Context;
use tokio::process::Command;

async fn run_git_in(workspace: &Path, args: &[&str]) -> anyhow::Result<std::process::Output> {
    Command::new("git")
        .args(["-c", "safe.directory=*"])
        .current_dir(workspace)
        .args(args)
        .output()
        .await
        .with_context(|| format!("git {}", args.join(" ")))
}

async fn prepare_workspace_dir(workspace: &Path) -> anyhow::Result<()> {
    if workspace.exists() {
        tokio::fs::remove_dir_all(workspace)
            .await
            .with_context(|| format!("remove existing workspace {}", workspace.display()))?;
    }
    if let Some(parent) = workspace.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .with_context(|| format!("create workspace parent {}", parent.display()))?;
    }
    Ok(())
}

/// Materialize a commit from a bare repository into `workspace`.
/// Uses a full clone (not `--local`) so checkout works when the repo and workspace
/// live on different mounts (e.g. data disk vs `/tmp`).
pub async fn checkout_commit(
    repo_path: &Path,
    commit_sha: &str,
    workspace: &Path,
) -> anyhow::Result<()> {
    checkout_commit_clone(repo_path, commit_sha, workspace).await
}

/// Best-effort cleanup for legacy linked worktrees (older runner versions).
pub async fn remove_worktree(repo_path: &Path, workspace: &Path) -> anyhow::Result<()> {
    if !workspace.exists() {
        return Ok(());
    }

    let remove = Command::new("git")
        .args(["-c", "safe.directory=*"])
        .arg(format!("--git-dir={}", repo_path.display()))
        .args([
            "worktree",
            "remove",
            "--force",
            workspace.to_str().context("workspace path is not valid UTF-8")?,
        ])
        .output()
        .await
        .context("git worktree remove")?;

    if !remove.status.success() {
        anyhow::bail!(
            "git worktree remove failed: {}",
            format_git_output(&remove)
        );
    }

    Ok(())
}

async fn checkout_commit_clone(
    repo_path: &Path,
    commit_sha: &str,
    workspace: &Path,
) -> anyhow::Result<()> {
    if !repo_path.is_dir() {
        anyhow::bail!("repository not found: {}", repo_path.display());
    }

    prepare_workspace_dir(workspace).await?;

    let clone_args = [
        "-c",
        "safe.directory=*",
        "clone",
        "--no-checkout",
        "--quiet",
        repo_path.to_str().context("repo path is not valid UTF-8")?,
        workspace.to_str().context("workspace path is not valid UTF-8")?,
    ];

    let clone = Command::new("git")
        .args(clone_args)
        .output()
        .await
        .context("git clone")?;

    if !clone.status.success() {
        anyhow::bail!("git clone failed: {}", format_git_output(&clone));
    }

    let checkout = run_git_in(workspace, &["checkout", "--detach", commit_sha]).await?;

    if !checkout.status.success() {
        anyhow::bail!("git checkout failed: {}", format_git_output(&checkout));
    }

    verify_workspace_populated(workspace, commit_sha).await
}

fn format_git_output(output: &std::process::Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    if !stderr.trim().is_empty() && !stdout.trim().is_empty() {
        format!("{stderr}\n{stdout}")
    } else if !stderr.trim().is_empty() {
        stderr.into_owned()
    } else {
        stdout.into_owned()
    }
}

async fn verify_workspace_populated(workspace: &Path, commit_sha: &str) -> anyhow::Result<()> {
    let mut entries = tokio::fs::read_dir(workspace).await.context("read workspace")?;
    if entries.next_entry().await?.is_none() {
        anyhow::bail!(
            "checkout produced empty workspace for commit {commit_sha}; \
             verify the commit has tracked files"
        );
    }
    Ok(())
}

/// Checkout `commit_sha` into a temp directory and return a gzip tar of the tree.
/// Uses a self-contained clone so extracted archives include a working `.git` directory.
pub async fn archive_commit(repo_path: &Path, commit_sha: &str) -> anyhow::Result<Vec<u8>> {
    let temp = tempfile::TempDir::new().context("create temp dir for archive")?;
    let workspace = temp.path().join("tree");
    checkout_commit_clone(repo_path, commit_sha, &workspace).await?;

    let output = Command::new("tar")
        .args(["czf", "-", "-C"])
        .arg(&workspace)
        .arg(".")
        .output()
        .await
        .context("tar archive")?;

    if !output.status.success() {
        anyhow::bail!(
            "tar failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    Ok(output.stdout)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command as StdCommand;

    fn bare_repo_with_commit() -> (tempfile::TempDir, std::path::PathBuf, String) {
        let tmp = tempfile::TempDir::new().unwrap();
        let bare = tmp.path().join("repo.git");
        StdCommand::new("git")
            .args(["init", "-q", "--bare"])
            .arg(&bare)
            .status()
            .unwrap();

        let src = tempfile::TempDir::new().unwrap();
        StdCommand::new("git")
            .current_dir(src.path())
            .args(["init", "-q"])
            .status()
            .unwrap();
        StdCommand::new("git")
            .current_dir(src.path())
            .args(["config", "user.email", "t@e.com"])
            .status()
            .unwrap();
        StdCommand::new("git")
            .current_dir(src.path())
            .args(["config", "user.name", "T"])
            .status()
            .unwrap();
        std::fs::write(src.path().join("file.txt"), "data").unwrap();
        StdCommand::new("git")
            .current_dir(src.path())
            .args(["add", "."])
            .status()
            .unwrap();
        StdCommand::new("git")
            .current_dir(src.path())
            .args(["commit", "-q", "-m", "init"])
            .status()
            .unwrap();
        StdCommand::new("git")
            .current_dir(src.path())
            .args(["remote", "add", "origin"])
            .arg(&bare)
            .status()
            .unwrap();
        StdCommand::new("git")
            .current_dir(src.path())
            .args(["push", "-q", "origin", "HEAD:refs/heads/main"])
            .status()
            .unwrap();
        let sha = String::from_utf8(
            StdCommand::new("git")
                .current_dir(src.path())
                .args(["rev-parse", "HEAD"])
                .output()
                .unwrap()
                .stdout,
        )
        .unwrap()
        .trim()
        .to_string();
        (tmp, bare, sha)
    }

    #[tokio::test]
    async fn checkout_commit_materializes_files() {
        let (_tmp, repo, sha) = bare_repo_with_commit();
        let workspace = tempfile::TempDir::new().unwrap();
        checkout_commit(&repo, &sha, workspace.path()).await.unwrap();
        let content = std::fs::read_to_string(workspace.path().join("file.txt")).unwrap();
        assert_eq!(content, "data");
    }

    #[tokio::test]
    async fn checkout_commit_exposes_git_metadata() {
        let (_tmp, repo, sha) = bare_repo_with_commit();
        let workspace = tempfile::TempDir::new().unwrap();
        checkout_commit(&repo, &sha, workspace.path()).await.unwrap();
        let status = StdCommand::new("git")
            .current_dir(workspace.path())
            .args(["status", "--short"])
            .output()
            .unwrap();
        assert!(status.status.success(), "git status should work in CI workspace");
    }

    #[tokio::test]
    async fn archive_commit_returns_gzip_tar() {
        let (_tmp, repo, sha) = bare_repo_with_commit();
        let archive = archive_commit(&repo, &sha).await.unwrap();
        assert!(archive.len() > 2);
        assert_eq!(&archive[0], &0x1f);
        assert_eq!(&archive[1], &0x8b);
    }

    #[tokio::test]
    async fn checkout_commit_errors_for_missing_repo() {
        let workspace = tempfile::TempDir::new().unwrap();
        let err = checkout_commit(Path::new("/no/such/repo.git"), "deadbeef", workspace.path())
            .await
            .unwrap_err();
        assert!(err.to_string().contains("repository not found"));
    }
}
