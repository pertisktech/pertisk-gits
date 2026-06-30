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
