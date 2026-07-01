use std::collections::HashMap;
use std::path::Path;

use anyhow::Context;
use tokio::process::Command;

#[derive(Debug, Clone)]
pub struct RefUpdate {
    pub ref_name: String,
    pub old_sha: Option<String>,
    pub new_sha: String,
}

/// Snapshot all ref names → object ids in a bare repository.
pub async fn snapshot_refs(repo_path: &Path) -> anyhow::Result<HashMap<String, String>> {
    let output = Command::new("git")
        .current_dir(repo_path)
        .args(["for-each-ref", "--format=%(objectname)\t%(refname)"])
        .output()
        .await
        .context("git for-each-ref")?;

    if !output.status.success() {
        anyhow::bail!(
            "git for-each-ref failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    let mut refs = HashMap::new();
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let Some((sha, ref_name)) = line.split_once('\t') else {
            continue;
        };
        if !sha.is_empty() && !ref_name.is_empty() {
            refs.insert(ref_name.to_string(), sha.to_string());
        }
    }
    Ok(refs)
}

/// Refs whose tip changed between two snapshots (typical post-receive set).
pub fn diff_refs(
    before: &HashMap<String, String>,
    after: &HashMap<String, String>,
) -> Vec<RefUpdate> {
    let mut updates = Vec::new();
    for (ref_name, new_sha) in after {
        let old_sha = before.get(ref_name).cloned();
        if old_sha.as_deref() != Some(new_sha.as_str()) {
            updates.push(RefUpdate {
                ref_name: ref_name.clone(),
                old_sha,
                new_sha: new_sha.clone(),
            });
        }
    }
    updates
}

/// Returns true when `ancestor` is an ancestor of `descendant` (or equal).
pub async fn is_ancestor(
    repo_path: &Path,
    ancestor: &str,
    descendant: &str,
) -> anyhow::Result<bool> {
    if ancestor == descendant {
        return Ok(true);
    }

    let output = Command::new("git")
        .arg(format!("--git-dir={}", repo_path.display()))
        .args(["-c", "safe.directory=*"])
        .args(["merge-base", "--is-ancestor", ancestor, descendant])
        .output()
        .await
        .context("git merge-base --is-ancestor")?;

    match output.status.code() {
        Some(0) => Ok(true),
        Some(1) => Ok(false),
        _ => anyhow::bail!(
            "git merge-base failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn diff_refs_detects_changes() {
        let mut before = HashMap::new();
        before.insert("refs/heads/main".into(), "aaa".into());
        before.insert("refs/heads/dev".into(), "bbb".into());

        let mut after = HashMap::new();
        after.insert("refs/heads/main".into(), "ccc".into());
        after.insert("refs/heads/dev".into(), "bbb".into());
        after.insert("refs/heads/new".into(), "ddd".into());

        let updates = diff_refs(&before, &after);
        assert_eq!(updates.len(), 2);
        let main = updates
            .iter()
            .find(|u| u.ref_name == "refs/heads/main")
            .unwrap();
        assert_eq!(main.old_sha.as_deref(), Some("aaa"));
        assert_eq!(main.new_sha, "ccc");
    }

    #[test]
    fn diff_refs_empty_when_unchanged() {
        let mut refs = HashMap::new();
        refs.insert("refs/heads/main".into(), "aaa".into());
        assert!(diff_refs(&refs, &refs).is_empty());
    }

    #[tokio::test]
    async fn snapshot_refs_reads_bare_repo() {
        let (_tmp, repo, sha) = bare_repo_with_commit();
        let refs = snapshot_refs(&repo).await.unwrap();
        assert_eq!(refs.get("refs/heads/main").map(String::as_str), Some(sha.as_str()));
    }

    #[tokio::test]
    async fn is_ancestor_detects_history() {
        let (_tmp, repo, sha) = bare_repo_with_commit();
        assert!(is_ancestor(&repo, &sha, &sha).await.unwrap());
        let other = "1111111111111111111111111111111111111111";
        let err = is_ancestor(&repo, other, &sha).await.unwrap_err();
        assert!(err.to_string().contains("git merge-base"));
    }

    fn bare_repo_with_commit() -> (tempfile::TempDir, std::path::PathBuf, String) {
        use std::process::Command;
        let tmp = tempfile::TempDir::new().unwrap();
        let worktree = tmp.path().to_path_buf();
        Command::new("git")
            .current_dir(&worktree)
            .args(["init", "-q"])
            .status()
            .unwrap();
        Command::new("git")
            .current_dir(&worktree)
            .args(["config", "user.email", "t@e.com"])
            .status()
            .unwrap();
        Command::new("git")
            .current_dir(&worktree)
            .args(["config", "user.name", "T"])
            .status()
            .unwrap();
        std::fs::write(worktree.join("file.txt"), "data").unwrap();
        Command::new("git")
            .current_dir(&worktree)
            .args(["add", "."])
            .status()
            .unwrap();
        Command::new("git")
            .current_dir(&worktree)
            .args(["commit", "-q", "-m", "init"])
            .status()
            .unwrap();
        let sha = String::from_utf8(
            Command::new("git")
                .current_dir(&worktree)
                .args(["rev-parse", "HEAD"])
                .output()
                .unwrap()
                .stdout,
        )
        .unwrap()
        .trim()
        .to_string();
        (tmp, worktree.join(".git"), sha)
    }
}
