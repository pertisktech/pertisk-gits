use std::path::Path;

use anyhow::Context;
use serde::Serialize;
use tokio::process::Command;

#[derive(Debug, Clone, Serialize)]
pub struct TreeEntry {
    pub name: String,
    pub path: String,
    pub kind: String,
    pub mode: String,
    pub size: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CommitInfo {
    pub sha: String,
    pub short_sha: String,
    pub author_name: String,
    pub author_email: String,
    pub committed_at: i64,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct RepoBrowser {
    pub branches: Vec<String>,
    pub default_ref: String,
    pub empty: bool,
}

pub async fn repo_browser(repo_path: &Path, default_branch: &str) -> anyhow::Result<RepoBrowser> {
    let branches = list_branches(repo_path).await?;
    let default_ref = branches
        .iter()
        .find(|b| b.as_str() == default_branch)
        .cloned()
        .or_else(|| branches.first().cloned())
        .unwrap_or_else(|| default_branch.to_string());

    let empty = !ref_exists(repo_path, &default_ref).await?;

    Ok(RepoBrowser {
        branches,
        default_ref,
        empty,
    })
}

pub async fn list_branches(repo_path: &Path) -> anyhow::Result<Vec<String>> {
    let output = git(repo_path, &["for-each-ref", "--format=%(refname:short)", "refs/heads/"])
        .await?;

    let branches: Vec<String> = output
        .lines()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .collect();

    Ok(branches)
}

pub async fn ref_exists(repo_path: &Path, ref_name: &str) -> anyhow::Result<bool> {
    let result = Command::new("git")
        .arg(format!("--git-dir={}", repo_path.display()))
        .args(["rev-parse", "--verify", &format!("refs/heads/{ref_name}")])
        .output()
        .await?;

    Ok(result.status.success())
}

pub async fn list_tree(repo_path: &Path, ref_name: &str, path: &str) -> anyhow::Result<Vec<TreeEntry>> {
    let tree_ref = if path.is_empty() {
        format!("refs/heads/{ref_name}")
    } else {
        format!("refs/heads/{ref_name}:{path}")
    };

    let output = git(repo_path, &["ls-tree", "-l", &tree_ref]).await?;

    let prefix = if path.is_empty() {
        String::new()
    } else {
        format!("{path}/")
    };

    let mut entries = Vec::new();
    for line in output.lines() {
        let Some(entry) = parse_ls_tree_line(line, &prefix) else {
            continue;
        };
        entries.push(entry);
    }

    entries.sort_by(|a, b| {
        let a_dir = a.kind == "tree";
        let b_dir = b.kind == "tree";
        b_dir.cmp(&a_dir).then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(entries)
}

pub async fn read_blob(repo_path: &Path, ref_name: &str, path: &str) -> anyhow::Result<String> {
    let object = format!("refs/heads/{ref_name}:{path}");
    git(repo_path, &["show", &object]).await
}

pub async fn list_commits(repo_path: &Path, ref_name: &str, limit: u32) -> anyhow::Result<Vec<CommitInfo>> {
    let refspec = format!("refs/heads/{ref_name}");
    let pretty = "%H%x1f%an%x1f%ae%x1f%at%x1f%s";
    let limit = limit.to_string();
    let pretty_arg = format!("--pretty=format:{pretty}");
    let output = git(
        repo_path,
        &["log", &refspec, "-n", &limit, &pretty_arg],
    )
    .await?;

    let mut commits = Vec::new();
    for line in output.lines() {
        let parts: Vec<&str> = line.split('\x1f').collect();
        if parts.len() < 5 {
            continue;
        }
        let sha = parts[0].to_string();
        commits.push(CommitInfo {
            short_sha: sha.chars().take(7).collect(),
            sha,
            author_name: parts[1].to_string(),
            author_email: parts[2].to_string(),
            committed_at: parts[3].parse().unwrap_or(0),
            message: parts[4].to_string(),
        });
    }

    Ok(commits)
}

fn parse_ls_tree_line(line: &str, prefix: &str) -> Option<TreeEntry> {
    // format: <mode> SP <type> SP <object> TAB <file>
    let (meta, name) = line.split_once('\t')?;
    let mut parts = meta.split_whitespace();
    let mode = parts.next()?.to_string();
    let kind = parts.next()?.to_string();
    let _object = parts.next()?;
    let size = parts.next().and_then(|s| s.parse().ok());

    let name = name.to_string();
    Some(TreeEntry {
        path: format!("{prefix}{name}"),
        name,
        kind,
        mode,
        size,
    })
}

async fn git(repo_path: &Path, args: &[&str]) -> anyhow::Result<String> {
    let output = Command::new("git")
        .arg(format!("--git-dir={}", repo_path.display()))
        .args(args)
        .output()
        .await
        .context("spawn git")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("git command failed: {stderr}");
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim_end().to_string())
}
