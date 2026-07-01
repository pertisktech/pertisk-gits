use std::path::Path;

use anyhow::Context;
use tokio::process::Command;

/// Materialize a commit from a bare repository into `workspace` without mutating the bare repo.
pub async fn checkout_commit(
    repo_path: &Path,
    commit_sha: &str,
    workspace: &Path,
) -> anyhow::Result<()> {
    if !repo_path.is_dir() {
        anyhow::bail!("repository not found: {}", repo_path.display());
    }

    tokio::fs::create_dir_all(workspace)
        .await
        .with_context(|| format!("create workspace {}", workspace.display()))?;

    let index_file = workspace
        .parent()
        .map(|dir| dir.join("index"))
        .unwrap_or_else(|| workspace.join(".git-index"));

    let git_base = |command: &mut Command| {
        command
            .args(["-c", "safe.directory=*"])
            .env("GIT_DIR", repo_path)
            .env("GIT_INDEX_FILE", &index_file)
            .arg("--work-tree")
            .arg(workspace);
    };

    let read_tree = {
        let mut command = Command::new("git");
        git_base(&mut command);
        command
            .args(["read-tree", commit_sha])
            .output()
            .await
            .context("git read-tree")?
    };

    if !read_tree.status.success() {
        anyhow::bail!(
            "git read-tree failed: {}",
            String::from_utf8_lossy(&read_tree.stderr)
        );
    }

    let checkout = {
        let mut command = Command::new("git");
        git_base(&mut command);
        command
            .args(["checkout-index", "-a", "-f"])
            .output()
            .await
            .context("git checkout-index")?
    };

    if !checkout.status.success() {
        anyhow::bail!(
            "git checkout-index failed: {}",
            String::from_utf8_lossy(&checkout.stderr)
        );
    }

    let _ = tokio::fs::remove_file(&index_file).await;

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
pub async fn archive_commit(repo_path: &Path, commit_sha: &str) -> anyhow::Result<Vec<u8>> {
    let temp = tempfile::TempDir::new().context("create temp dir for archive")?;
    let workspace = temp.path().join("tree");
    checkout_commit(repo_path, commit_sha, &workspace).await?;

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
        let worktree = tmp.path().to_path_buf();
        StdCommand::new("git").current_dir(&worktree).args(["init", "-q"]).status().unwrap();
        StdCommand::new("git").current_dir(&worktree).args(["config", "user.email", "t@e.com"]).status().unwrap();
        StdCommand::new("git").current_dir(&worktree).args(["config", "user.name", "T"]).status().unwrap();
        std::fs::write(worktree.join("file.txt"), "data").unwrap();
        StdCommand::new("git").current_dir(&worktree).args(["add", "."]).status().unwrap();
        StdCommand::new("git").current_dir(&worktree).args(["commit", "-q", "-m", "init"]).status().unwrap();
        let sha = String::from_utf8(
            StdCommand::new("git").current_dir(&worktree).args(["rev-parse", "HEAD"]).output().unwrap().stdout,
        )
        .unwrap()
        .trim()
        .to_string();
        (tmp, worktree.join(".git"), sha)
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
