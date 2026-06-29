use std::path::Path;
use std::process::Output;

use anyhow::Context;
use serde::Serialize;
use tokio::process::Command;

#[derive(Debug, Clone, Serialize)]
pub struct EntryLastCommit {
    pub sha: String,
    pub short_sha: String,
    pub message: String,
    pub committed_at: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct TreeEntry {
    pub name: String,
    pub path: String,
    pub kind: String,
    pub mode: String,
    pub size: Option<u64>,
    pub last_commit: Option<EntryLastCommit>,
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
pub struct TagInfo {
    pub name: String,
    pub sha: String,
    pub short_sha: String,
    pub message: String,
    pub tagger_name: String,
    pub tagged_at: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct RepoBrowser {
    pub branches: Vec<String>,
    pub tags: Vec<String>,
    pub default_ref: String,
    pub empty: bool,
}

pub async fn repo_browser(repo_path: &Path, default_branch: &str) -> anyhow::Result<RepoBrowser> {
    let branches = list_branches(repo_path).await?;
    let tags = list_tags(repo_path).await?;
    let default_ref = branches
        .iter()
        .find(|b| b.as_str() == default_branch)
        .cloned()
        .or_else(|| branches.first().cloned())
        .unwrap_or_else(|| default_branch.to_string());

    let empty = branches.is_empty() || !ref_exists(repo_path, &default_ref).await?;

    Ok(RepoBrowser {
        branches,
        tags,
        default_ref,
        empty,
    })
}

pub async fn list_branches(repo_path: &Path) -> anyhow::Result<Vec<String>> {
    list_refs(repo_path, "refs/heads/").await
}

pub async fn list_tags(repo_path: &Path) -> anyhow::Result<Vec<String>> {
    list_refs(repo_path, "refs/tags/").await
}

pub async fn list_tag_details(repo_path: &Path) -> anyhow::Result<Vec<TagInfo>> {
    const SEP: char = '\x1f';
    let pretty = format!(
        "--format=%(refname:short){SEP}%(objectname){SEP}%(*objectname){SEP}%(committerdate:unix){SEP}%(*committerdate:unix){SEP}%(subject){SEP}%(*subject){SEP}%(taggername){SEP}%(creatordate:unix)",
        SEP = SEP,
    );
    let output = git(
        repo_path,
        &[
            "for-each-ref",
            "--sort=-creatordate",
            "refs/tags/",
            &pretty,
        ],
    )
    .await?;

    let mut tags = Vec::new();
    for line in output.lines() {
        let parts: Vec<&str> = line.split(SEP).collect();
        if parts.len() < 9 {
            continue;
        }

        let sha = if parts[2].is_empty() {
            parts[1].trim()
        } else {
            parts[2].trim()
        };
        if sha.is_empty() {
            continue;
        }

        let commit_date = if parts[4].is_empty() {
            parts[3].trim().parse().unwrap_or(0)
        } else {
            parts[4].trim().parse().unwrap_or(0)
        };
        let tag_date = parts[8].trim().parse().unwrap_or(commit_date);
        let tagger_name = parts[7].trim().to_string();
        let tagged_at = if tagger_name.is_empty() {
            commit_date
        } else {
            tag_date
        };
        let message = if parts[5].is_empty() {
            parts[6].trim().to_string()
        } else {
            parts[5].trim().to_string()
        };

        tags.push(TagInfo {
            name: parts[0].trim().to_string(),
            short_sha: sha.chars().take(7).collect(),
            sha: sha.to_string(),
            message,
            tagger_name,
            tagged_at,
        });
    }

    Ok(tags)
}

#[derive(Debug, Clone)]
pub struct TaggerIdentity<'a> {
    pub name: &'a str,
    pub email: &'a str,
}

pub async fn create_tag(
    repo_path: &Path,
    name: &str,
    target: &str,
    message: Option<&str>,
    tagger: Option<TaggerIdentity<'_>>,
) -> anyhow::Result<TagInfo> {
    let name = name.trim();
    validate_tag_name(name)?;

    if tag_exists(repo_path, name).await? {
        anyhow::bail!("tag '{name}' already exists");
    }

    let commit_sha = resolve_commit_target(repo_path, target).await?;
    let annotated = message.map(str::trim).is_some_and(|value| !value.is_empty());

    let mut cmd = Command::new("git");
    cmd.arg(format!("--git-dir={}", repo_path.display()));
    if annotated {
        let TaggerIdentity { name: tagger_name, email } = tagger.ok_or_else(|| {
            anyhow::anyhow!("tagger identity is required for annotated tags")
        })?;
        cmd.args([
            "-c",
            &format!("user.name={tagger_name}"),
            "-c",
            &format!("user.email={email}"),
        ]);
        cmd.args([
            "tag",
            "-a",
            name,
            &commit_sha,
            "-m",
            message.unwrap().trim(),
        ]);
    } else {
        cmd.args(["tag", name, &commit_sha]);
    }

    let output = cmd.output().await.context("spawn git tag")?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("git tag failed: {stderr}");
    }

    let tags = list_tag_details(repo_path).await?;
    tags.into_iter()
        .find(|tag| tag.name == name)
        .ok_or_else(|| anyhow::anyhow!("failed to read created tag '{name}'"))
}

fn validate_tag_name(name: &str) -> anyhow::Result<()> {
    if name.is_empty() {
        anyhow::bail!("tag name is required");
    }
    if name.len() > 255 {
        anyhow::bail!("tag name is too long");
    }
    if name.starts_with('.')
        || name.ends_with('.')
        || name.ends_with(".lock")
        || name.contains("..")
        || name.contains('/')
        || name.contains('\\')
        || name.contains(' ')
        || name.contains('~')
        || name.contains('^')
        || name.contains(':')
        || name.contains('?')
        || name.contains('*')
        || name.contains('[')
    {
        anyhow::bail!("invalid tag name");
    }
    Ok(())
}

async fn resolve_commit_target(repo_path: &Path, target: &str) -> anyhow::Result<String> {
    let target = target.trim();
    if target.is_empty() {
        anyhow::bail!("target ref is required");
    }

    let candidates = [
        format!("refs/heads/{target}"),
        format!("refs/tags/{target}"),
        format!("{target}^{{commit}}"),
        target.to_string(),
    ];

    for spec in candidates {
        let result = Command::new("git")
            .arg(format!("--git-dir={}", repo_path.display()))
            .args(["rev-parse", "--verify", &spec])
            .output()
            .await
            .context("spawn git rev-parse")?;

        if result.status.success() {
            return Ok(String::from_utf8_lossy(&result.stdout).trim().to_string());
        }
    }

    anyhow::bail!("target '{target}' not found");
}

async fn list_refs(repo_path: &Path, prefix: &str) -> anyhow::Result<Vec<String>> {
    let output = git(
        repo_path,
        &["for-each-ref", "--format=%(refname:short)", prefix],
    )
    .await?;

    let refs: Vec<String> = output
        .lines()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .collect();

    Ok(refs)
}

pub async fn ref_exists(repo_path: &Path, ref_name: &str) -> anyhow::Result<bool> {
    ref_exists_kind(repo_path, ref_name, RefKind::Branch).await
}

pub async fn tag_exists(repo_path: &Path, tag_name: &str) -> anyhow::Result<bool> {
    ref_exists_kind(repo_path, tag_name, RefKind::Tag).await
}

#[derive(Debug, Clone, Copy)]
pub enum RefKind {
    Branch,
    Tag,
}

pub async fn ref_exists_kind(
    repo_path: &Path,
    ref_name: &str,
    kind: RefKind,
) -> anyhow::Result<bool> {
    let full_ref = match kind {
        RefKind::Branch => format!("refs/heads/{ref_name}"),
        RefKind::Tag => format!("refs/tags/{ref_name}"),
    };

    let result = Command::new("git")
        .arg(format!("--git-dir={}", repo_path.display()))
        .args(["rev-parse", "--verify", &full_ref])
        .output()
        .await?;

    Ok(result.status.success())
}

fn resolve_object(ref_name: &str, kind: RefKind, path: &str) -> String {
    let prefix = match kind {
        RefKind::Branch => format!("refs/heads/{ref_name}"),
        RefKind::Tag => format!("refs/tags/{ref_name}"),
    };

    if path.is_empty() {
        prefix
    } else {
        format!("{prefix}:{path}")
    }
}

pub async fn list_tree(
    repo_path: &Path,
    ref_name: &str,
    kind: RefKind,
    path: &str,
) -> anyhow::Result<Vec<TreeEntry>> {
    if !ref_exists_kind(repo_path, ref_name, kind).await? {
        let label = match kind {
            RefKind::Branch => "branch",
            RefKind::Tag => "tag",
        };
        anyhow::bail!("{label} '{ref_name}' not found");
    }

    let tree_ref = resolve_object(ref_name, kind, path);

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

    let last_commits = futures_util::future::join_all(entries.iter().map(|entry| {
        last_commit_for_path(repo_path, ref_name, kind, &entry.path)
    }))
    .await;

    for (entry, last_commit) in entries.iter_mut().zip(last_commits) {
        entry.last_commit = last_commit.ok().flatten();
    }

    Ok(entries)
}

async fn last_commit_for_path(
    repo_path: &Path,
    ref_name: &str,
    kind: RefKind,
    path: &str,
) -> anyhow::Result<Option<EntryLastCommit>> {
    let refspec = match kind {
        RefKind::Branch => format!("refs/heads/{ref_name}"),
        RefKind::Tag => format!("refs/tags/{ref_name}"),
    };

    let pretty = "%H%x1f%at%x1f%s";
    let pretty_arg = format!("--pretty=format:{pretty}");
    let output = Command::new("git")
        .arg(format!("--git-dir={}", repo_path.display()))
        .args(["log", "-1", &pretty_arg, &refspec, "--", path])
        .output()
        .await
        .context("spawn git log")?;

    if !output.status.success() {
        return Ok(None);
    }

    let line = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if line.is_empty() {
        return Ok(None);
    }

    let parts: Vec<&str> = line.split('\x1f').collect();
    if parts.len() < 3 {
        return Ok(None);
    }

    let sha = parts[0].to_string();
    Ok(Some(EntryLastCommit {
        short_sha: sha.chars().take(7).collect(),
        sha,
        committed_at: parts[1].parse().unwrap_or(0),
        message: parts[2].to_string(),
    }))
}

pub async fn read_blob(
    repo_path: &Path,
    ref_name: &str,
    kind: RefKind,
    path: &str,
) -> anyhow::Result<String> {
    let bytes = read_blob_bytes(repo_path, ref_name, kind, path).await?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

pub async fn read_blob_bytes(
    repo_path: &Path,
    ref_name: &str,
    kind: RefKind,
    path: &str,
) -> anyhow::Result<Vec<u8>> {
    if !ref_exists_kind(repo_path, ref_name, kind).await? {
        let label = match kind {
            RefKind::Branch => "branch",
            RefKind::Tag => "tag",
        };
        anyhow::bail!("{label} '{ref_name}' not found");
    }

    let object = resolve_object(ref_name, kind, path);
    git_bytes(repo_path, &["show", &object]).await
}

pub async fn list_commits(
    repo_path: &Path,
    ref_name: &str,
    kind: RefKind,
    limit: u32,
) -> anyhow::Result<Vec<CommitInfo>> {
    if !ref_exists_kind(repo_path, ref_name, kind).await? {
        let label = match kind {
            RefKind::Branch => "branch",
            RefKind::Tag => "tag",
        };
        anyhow::bail!("{label} '{ref_name}' not found");
    }

    let refspec = match kind {
        RefKind::Branch => format!("refs/heads/{ref_name}"),
        RefKind::Tag => format!("refs/tags/{ref_name}"),
    };
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

#[derive(Debug, Clone, Serialize)]
pub struct CommitDetail {
    pub sha: String,
    pub short_sha: String,
    pub author_name: String,
    pub author_email: String,
    pub committed_at: i64,
    pub message: String,
    pub body: String,
    pub parents: Vec<String>,
    pub diff: String,
    pub files_changed: u32,
    pub insertions: u32,
    pub deletions: u32,
}

pub async fn get_commit(repo_path: &Path, sha: &str) -> anyhow::Result<CommitDetail> {
    verify_commit(repo_path, sha).await?;

    let meta = git(
        repo_path,
        &[
            "show",
            "-s",
            "--format=%H%x1f%an%x1f%ae%x1f%at%x1f%P%x1f%s%x1f%B",
            sha,
        ],
    )
    .await?;

    let parts: Vec<&str> = meta.splitn(7, '\x1f').collect();
    if parts.len() < 7 {
        anyhow::bail!("failed to parse commit metadata");
    }

    let full_sha = parts[0].to_string();
    let parents: Vec<String> = parts[4]
        .split_whitespace()
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .collect();
    let subject = parts[5].to_string();
    let body = parts[6].trim().to_string();

    let shortstat = git(
        repo_path,
        &["show", "-s", "--shortstat", "--format=", sha],
    )
    .await
    .unwrap_or_default();

    let (files_changed, insertions, deletions) = parse_shortstat(&shortstat);

    let diff = git(repo_path, &["show", "--format=", "--patch", "--no-color", sha])
        .await
        .unwrap_or_default();

    Ok(CommitDetail {
        short_sha: full_sha.chars().take(7).collect(),
        sha: full_sha,
        author_name: parts[1].to_string(),
        author_email: parts[2].to_string(),
        committed_at: parts[3].parse().unwrap_or(0),
        message: subject,
        body,
        parents,
        diff,
        files_changed,
        insertions,
        deletions,
    })
}

async fn verify_commit(repo_path: &Path, sha: &str) -> anyhow::Result<()> {
    let result = Command::new("git")
        .arg(format!("--git-dir={}", repo_path.display()))
        .args(["rev-parse", "--verify", &format!("{sha}^{{commit}}")])
        .output()
        .await?;

    if !result.status.success() {
        anyhow::bail!("commit '{sha}' not found");
    }

    Ok(())
}

fn parse_shortstat(stat: &str) -> (u32, u32, u32) {
    let line = stat.lines().last().unwrap_or("").trim();
    let mut files_changed = 0u32;
    let mut insertions = 0u32;
    let mut deletions = 0u32;

    for part in line.split(',') {
        let part = part.trim();
        if let Some(n) = part.split_whitespace().next().and_then(|s| s.parse().ok()) {
            if part.contains("file") {
                files_changed = n;
            } else if part.contains("insertion") {
                insertions = n;
            } else if part.contains("deletion") {
                deletions = n;
            }
        }
    }

    (files_changed, insertions, deletions)
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
        last_commit: None,
    })
}

async fn git(repo_path: &Path, args: &[&str]) -> anyhow::Result<String> {
    let bytes = git_bytes(repo_path, args).await?;
    Ok(String::from_utf8_lossy(&bytes).trim_end().to_string())
}

async fn git_bytes(repo_path: &Path, args: &[&str]) -> anyhow::Result<Vec<u8>> {
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

    Ok(output.stdout)
}

fn format_git_failure(output: &Output, action: &str) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();

    match (stderr.is_empty(), stdout.is_empty()) {
        (false, false) => format!("{action}: {stderr}; {stdout}"),
        (false, true) => format!("{action}: {stderr}"),
        (true, false) => format!("{action}: {stdout}"),
        (true, true) => format!("{action}: git exited with {}", output.status),
    }
}

fn git_output_indicates_conflict(output: &Output) -> bool {
    let combined = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stderr),
        String::from_utf8_lossy(&output.stdout),
    );
    combined.contains("CONFLICT")
        || combined.contains("changed in both")
        || combined.contains("<<<<<<<")
}

async fn is_mergeable_write_tree(
    repo_path: &Path,
    base_ref: &str,
    head_ref: &str,
) -> anyhow::Result<bool> {
    let output = Command::new("git")
        .arg(format!("--git-dir={}", repo_path.display()))
        .args(["merge-tree", "--write-tree", base_ref, head_ref])
        .output()
        .await
        .context("spawn git merge-tree")?;

    Ok(output.status.success())
}

pub async fn create_archive(
    repo_path: &Path,
    ref_name: &str,
    kind: RefKind,
) -> anyhow::Result<Vec<u8>> {
    if !ref_exists_kind(repo_path, ref_name, kind).await? {
        let label = match kind {
            RefKind::Branch => "branch",
            RefKind::Tag => "tag",
        };
        anyhow::bail!("{label} '{ref_name}' not found");
    }

    let archive_ref = match kind {
        RefKind::Branch => format!("refs/heads/{ref_name}"),
        RefKind::Tag => format!("refs/tags/{ref_name}"),
    };

    git_bytes(
        repo_path,
        &["archive", "--format=zip", "--output=-", &archive_ref],
    )
    .await
}

#[derive(Debug, Clone, Serialize)]
pub struct CompareResult {
    pub base: String,
    pub head: String,
    pub merge_base: String,
    pub diff: String,
    pub commits: Vec<CommitInfo>,
    pub files_changed: u32,
    pub insertions: u32,
    pub deletions: u32,
    pub mergeable: bool,
}

pub async fn compare_branches(
    repo_path: &Path,
    base_branch: &str,
    head_branch: &str,
) -> anyhow::Result<CompareResult> {
    if !ref_exists(repo_path, base_branch).await? {
        anyhow::bail!("branch '{base_branch}' not found");
    }
    if !ref_exists(repo_path, head_branch).await? {
        anyhow::bail!("branch '{head_branch}' not found");
    }

    let base_ref = format!("refs/heads/{base_branch}");
    let head_ref = format!("refs/heads/{head_branch}");

    let merge_base = git(
        repo_path,
        &["merge-base", &base_ref, &head_ref],
    )
    .await?;

    let diff = git(
        repo_path,
        &["diff", "--patch", "--no-color", &format!("{merge_base}...{head_ref}")],
    )
    .await
    .unwrap_or_default();

    let shortstat = git(
        repo_path,
        &["diff", "--shortstat", &format!("{merge_base}...{head_ref}")],
    )
    .await
    .unwrap_or_default();
    let (files_changed, insertions, deletions) = parse_shortstat(&shortstat);

    let log_output = git(
        repo_path,
        &[
            "log",
            &format!("{merge_base}..{head_ref}"),
            "--format=%H%x1f%an%x1f%ae%x1f%at%x1f%s",
        ],
    )
    .await
    .unwrap_or_default();

    let commits: Vec<CommitInfo> = log_output
        .lines()
        .filter(|line| !line.is_empty())
        .filter_map(|line| {
            let parts: Vec<&str> = line.split('\x1f').collect();
            if parts.len() < 5 {
                return None;
            }
            let sha = parts[0].to_string();
            Some(CommitInfo {
                short_sha: sha.chars().take(7).collect(),
                sha,
                author_name: parts[1].to_string(),
                author_email: parts[2].to_string(),
                committed_at: parts[3].parse().unwrap_or(0),
                message: parts[4].to_string(),
            })
        })
        .collect();

    let mergeable = is_mergeable_write_tree(repo_path, &base_ref, &head_ref).await?;

    Ok(CompareResult {
        base: base_branch.to_string(),
        head: head_branch.to_string(),
        merge_base,
        diff,
        commits,
        files_changed,
        insertions,
        deletions,
        mergeable,
    })
}

pub async fn merge_branches(
    repo_path: &Path,
    target_branch: &str,
    source_branch: &str,
    message: &str,
) -> anyhow::Result<String> {
    let (tree_sha, target_ref, parents) =
        prepare_merge(repo_path, target_branch, source_branch).await?;

    let target_sha = parents[0].clone();
    let source_sha = parents[1].clone();

    create_commit_and_update_ref(
        repo_path,
        &target_ref,
        &tree_sha,
        &[target_sha.as_str(), source_sha.as_str()],
        message,
    )
    .await
}

pub async fn squash_branches(
    repo_path: &Path,
    target_branch: &str,
    source_branch: &str,
    message: &str,
) -> anyhow::Result<String> {
    let (tree_sha, target_ref, parents) =
        prepare_merge(repo_path, target_branch, source_branch).await?;

    create_commit_and_update_ref(
        repo_path,
        &target_ref,
        &tree_sha,
        &[parents[0].as_str()],
        message,
    )
    .await
}

/// Replay commits from `source_branch` onto `target_branch` and advance the target ref (rebase merge).
pub async fn rebase_branches(
    repo_path: &Path,
    target_branch: &str,
    source_branch: &str,
) -> anyhow::Result<String> {
    if target_branch == source_branch {
        anyhow::bail!("source and target branches must differ");
    }
    if !ref_exists(repo_path, target_branch).await? {
        anyhow::bail!("branch '{target_branch}' not found");
    }
    if !ref_exists(repo_path, source_branch).await? {
        anyhow::bail!("branch '{source_branch}' not found");
    }

    let compare = compare_branches(repo_path, target_branch, source_branch).await?;
    if compare.commits.is_empty() {
        anyhow::bail!("nothing to merge from '{source_branch}' into '{target_branch}'");
    }
    if !compare.mergeable {
        anyhow::bail!("merge conflict detected");
    }

    let target_ref = format!("refs/heads/{target_branch}");
    let source_ref = format!("refs/heads/{source_branch}");
    let old_target_sha = git(repo_path, &["rev-parse", &target_ref]).await?;

    let temp = tempfile::tempdir().context("create temp dir for rebase")?;
    let wt_path = temp.path().join("wt");

    let add = Command::new("git")
        .arg(format!("--git-dir={}", repo_path.display()))
        .args(["worktree", "add", "-f"])
        .arg(&wt_path)
        .arg(source_branch)
        .output()
        .await
        .context("spawn git worktree add")?;

    if !add.status.success() {
        anyhow::bail!(format_git_failure(&add, "git worktree add failed"));
    }

    let rebase = Command::new("git")
        .current_dir(&wt_path)
        .args(["rebase", target_branch])
        .output()
        .await
        .context("spawn git rebase")?;

    if !rebase.status.success() {
        let _ = Command::new("git")
            .current_dir(&wt_path)
            .args(["rebase", "--abort"])
            .output()
            .await;
        let _ = Command::new("git")
            .arg(format!("--git-dir={}", repo_path.display()))
            .args(["worktree", "remove", "--force"])
            .arg(&wt_path)
            .output()
            .await;

        if git_output_indicates_conflict(&rebase) {
            anyhow::bail!("merge conflict detected");
        }
        anyhow::bail!(format_git_failure(&rebase, "rebase failed"));
    }

    let new_sha = git(repo_path, &["rev-parse", &source_ref]).await?;

    let update = Command::new("git")
        .arg(format!("--git-dir={}", repo_path.display()))
        .args(["update-ref", &target_ref, &new_sha, &old_target_sha])
        .output()
        .await
        .context("spawn git update-ref")?;

    if !update.status.success() {
        anyhow::bail!(format_git_failure(&update, "update target branch failed"));
    }

    let remove = Command::new("git")
        .arg(format!("--git-dir={}", repo_path.display()))
        .args(["worktree", "remove", "--force"])
        .arg(&wt_path)
        .output()
        .await
        .context("spawn git worktree remove")?;

    if !remove.status.success() {
        anyhow::bail!(format_git_failure(&remove, "git worktree remove failed"));
    }

    Ok(new_sha)
}

async fn prepare_merge(
    repo_path: &Path,
    target_branch: &str,
    source_branch: &str,
) -> anyhow::Result<(String, String, Vec<String>)> {
    if target_branch == source_branch {
        anyhow::bail!("source and target branches must differ");
    }
    if !ref_exists(repo_path, target_branch).await? {
        anyhow::bail!("branch '{target_branch}' not found");
    }
    if !ref_exists(repo_path, source_branch).await? {
        anyhow::bail!("branch '{source_branch}' not found");
    }

    let compare = compare_branches(repo_path, target_branch, source_branch).await?;
    if !compare.mergeable {
        anyhow::bail!("merge conflict detected");
    }

    let target_ref = format!("refs/heads/{target_branch}");
    let source_ref = format!("refs/heads/{source_branch}");

    let target_sha = git(repo_path, &["rev-parse", &target_ref]).await?;
    let source_sha = git(repo_path, &["rev-parse", &source_ref]).await?;

    let merge_tree = Command::new("git")
        .arg(format!("--git-dir={}", repo_path.display()))
        .args(["merge-tree", "--write-tree", &target_ref, &source_ref])
        .output()
        .await
        .context("spawn git merge-tree")?;

    if !merge_tree.status.success() {
        if git_output_indicates_conflict(&merge_tree) {
            anyhow::bail!("merge conflict detected");
        }
        anyhow::bail!(format_git_failure(&merge_tree, "merge failed"));
    }

    let tree_sha = String::from_utf8_lossy(&merge_tree.stdout).trim().to_string();
    if tree_sha.is_empty() || tree_sha.contains('\n') {
        anyhow::bail!(format_git_failure(&merge_tree, "merge failed"));
    }

    Ok((tree_sha, target_ref, vec![target_sha, source_sha]))
}

async fn create_commit_and_update_ref(
    repo_path: &Path,
    target_ref: &str,
    tree_sha: &str,
    parents: &[&str],
    message: &str,
) -> anyhow::Result<String> {
    let mut args = vec![
        "-c",
        "user.name=pertisk-gits",
        "-c",
        "user.email=pertisk-gits@localhost",
        "commit-tree",
        tree_sha,
    ];
    for parent in parents {
        args.push("-p");
        args.push(*parent);
    }
    args.push("-m");
    args.push(message);

    let commit_output = Command::new("git")
        .arg(format!("--git-dir={}", repo_path.display()))
        .args(args)
        .output()
        .await
        .context("spawn git commit-tree")?;

    if !commit_output.status.success() {
        anyhow::bail!(format_git_failure(&commit_output, "merge failed"));
    }

    let merge_sha = String::from_utf8_lossy(&commit_output.stdout)
        .trim()
        .to_string();

    git(repo_path, &["update-ref", target_ref, &merge_sha]).await?;

    Ok(merge_sha)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[tokio::test]
    async fn list_tag_details_reads_lightweight_and_annotated_tags() {
        let repo = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../data/repos/gitlab/mp/digimall/backend/adaptor-ais-query.git");
        if !repo.exists() {
            return;
        }

        let tags = list_tag_details(&repo).await.expect("list tags");
        assert_eq!(tags.len(), 14, "expected all repository tags");
        assert!(
            tags.iter()
                .any(|tag| tag.name == "0.0.12" && tag.sha.len() == 40),
            "annotated tag should resolve peeled commit sha"
        );
        assert!(
            tags.iter()
                .any(|tag| tag.name == "0.0.10" && tag.sha.len() == 40),
            "lightweight tag should resolve commit sha"
        );
    }
}
