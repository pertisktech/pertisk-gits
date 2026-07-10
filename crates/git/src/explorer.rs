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
pub struct BranchInfo {
    pub name: String,
    pub sha: String,
    pub short_sha: String,
    pub committed_at: i64,
    pub author_name: String,
    pub message: String,
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

pub async fn list_branch_details(repo_path: &Path) -> anyhow::Result<Vec<BranchInfo>> {
    const SEP: char = '\x1f';
    let pretty = format!(
        "--format=%(refname:short){SEP}%(objectname){SEP}%(committerdate:unix){SEP}%(authorname){SEP}%(subject)",
        SEP = SEP,
    );
    let output = git(
        repo_path,
        &[
            "for-each-ref",
            "--sort=-committerdate",
            "refs/heads/",
            &pretty,
        ],
    )
    .await?;

    let mut branches = Vec::new();
    for line in output.lines() {
        let parts: Vec<&str> = line.split(SEP).collect();
        if parts.len() < 5 {
            continue;
        }

        let sha = parts[1].trim();
        if sha.is_empty() {
            continue;
        }

        branches.push(BranchInfo {
            name: parts[0].trim().to_string(),
            short_sha: sha.chars().take(7).collect(),
            sha: sha.to_string(),
            committed_at: parts[2].trim().parse().unwrap_or(0),
            author_name: parts[3].trim().to_string(),
            message: parts[4].trim().to_string(),
        });
    }

    Ok(branches)
}

pub async fn create_branch(
    repo_path: &Path,
    name: &str,
    source: &str,
) -> anyhow::Result<BranchInfo> {
    let name = name.trim();
    validate_branch_name(name)?;

    if ref_exists(repo_path, name).await? {
        anyhow::bail!("branch '{name}' already exists");
    }

    let sha = resolve_commit_target(repo_path, source).await?;
    let branch_ref = format!("refs/heads/{name}");
    git(repo_path, &["update-ref", &branch_ref, &sha]).await?;

    list_branch_details(repo_path)
        .await?
        .into_iter()
        .find(|branch| branch.name == name)
        .ok_or_else(|| anyhow::anyhow!("failed to read created branch '{name}'"))
}

pub async fn branch_head_sha(repo_path: &Path, name: &str) -> anyhow::Result<String> {
    let name = name.trim();
    validate_branch_name(name)?;

    if !ref_exists(repo_path, name).await? {
        anyhow::bail!("branch '{name}' not found");
    }

    rev_parse_ref(repo_path, &format!("refs/heads/{name}")).await
}

pub async fn delete_branch(repo_path: &Path, name: &str) -> anyhow::Result<String> {
    let old_sha = branch_head_sha(repo_path, name).await?;
    let branch_ref = format!("refs/heads/{name}");
    git(repo_path, &["update-ref", "-d", &branch_ref]).await?;
    Ok(old_sha)
}

async fn rev_parse_ref(repo_path: &Path, reference: &str) -> anyhow::Result<String> {
    let output = Command::new("git")
        .arg(format!("--git-dir={}", repo_path.display()))
        .args(["rev-parse", reference])
        .output()
        .await
        .context("spawn git rev-parse")?;

    if !output.status.success() {
        anyhow::bail!("failed to resolve reference '{reference}'");
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn validate_branch_name(name: &str) -> anyhow::Result<()> {
    if name.is_empty() {
        anyhow::bail!("branch name is required");
    }
    if name.len() > 255 {
        anyhow::bail!("branch name is too long");
    }
    if name.starts_with('.')
        || name.ends_with('.')
        || name.ends_with(".lock")
        || name.contains("..")
        || name.contains('\\')
        || name.contains(' ')
        || name.contains('~')
        || name.contains('^')
        || name.contains(':')
        || name.contains('?')
        || name.contains('*')
        || name.contains('[')
    {
        anyhow::bail!("invalid branch name");
    }
    Ok(())
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

pub async fn tag_head_sha(repo_path: &Path, name: &str) -> anyhow::Result<String> {
    let name = name.trim();
    validate_tag_name(name)?;

    if !tag_exists(repo_path, name).await? {
        anyhow::bail!("tag '{name}' not found");
    }

    rev_parse_ref(repo_path, &format!("refs/tags/{name}")).await
}

pub async fn delete_tag(repo_path: &Path, name: &str) -> anyhow::Result<String> {
    let old_sha = tag_head_sha(repo_path, name).await?;
    let tag_ref = format!("refs/tags/{name}");
    git(repo_path, &["update-ref", "-d", &tag_ref]).await?;
    Ok(old_sha)
}

pub async fn update_tag(
    repo_path: &Path,
    current_name: &str,
    new_name: Option<&str>,
    target: Option<&str>,
    message: Option<&str>,
    tagger: Option<TaggerIdentity<'_>>,
) -> anyhow::Result<TagInfo> {
    let current_name = current_name.trim();
    validate_tag_name(current_name)?;

    let current = list_tag_details(repo_path)
        .await?
        .into_iter()
        .find(|tag| tag.name == current_name)
        .ok_or_else(|| anyhow::anyhow!("tag '{current_name}' not found"))?;

    let final_name = new_name.map(str::trim).filter(|value| !value.is_empty()).unwrap_or(current_name);
    validate_tag_name(final_name)?;

    if final_name != current_name && tag_exists(repo_path, final_name).await? {
        anyhow::bail!("tag '{final_name}' already exists");
    }

    let commit_sha = match target.map(str::trim).filter(|value| !value.is_empty()) {
        Some(target) => resolve_commit_target(repo_path, target).await?,
        None => current.sha.clone(),
    };

    let annotated_message = match message {
        Some(value) => {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }
        None => {
            if !current.message.is_empty() {
                Some(current.message.clone())
            } else {
                None
            }
        }
    };

    let tagger = if annotated_message.is_some() || !current.tagger_name.is_empty() {
        Some(tagger.ok_or_else(|| {
            anyhow::anyhow!("tagger identity is required for annotated tags")
        })?)
    } else {
        tagger
    };

    delete_tag(repo_path, current_name).await?;

    create_tag(
        repo_path,
        final_name,
        &commit_sha,
        annotated_message.as_deref(),
        tagger,
    )
    .await
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

    let _ = crate::storage::ensure_bare_repo_refs_dirs(repo_path);
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
        if path.is_empty() {
            return Ok(Vec::new());
        }
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

#[derive(Debug, Clone, Serialize)]
pub struct BlameLine {
    pub line_number: u32,
    pub commit_sha: String,
    pub short_sha: String,
    pub author_name: String,
    pub author_email: String,
    pub committed_at: i64,
    pub content: String,
}

pub async fn file_blame(
    repo_path: &Path,
    ref_name: &str,
    kind: RefKind,
    path: &str,
) -> anyhow::Result<Vec<BlameLine>> {
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

    let output = git(
        repo_path,
        &["blame", "--line-porcelain", &refspec, "--", path],
    )
    .await?;

    Ok(parse_blame_porcelain(&output))
}

fn parse_blame_porcelain(output: &str) -> Vec<BlameLine> {
    let mut lines = Vec::new();
    let mut commit_sha = String::new();
    let mut author_name = String::new();
    let mut author_email = String::new();
    let mut author_time: i64 = 0;
    let mut group_start_line: u32 = 0;
    let mut line_in_group: u32 = 0;

    for line in output.lines() {
        if let Some(header) = parse_blame_header(line) {
            commit_sha = header.0;
            group_start_line = header.1;
            line_in_group = 0;
            continue;
        }
        if let Some(rest) = line.strip_prefix("author ") {
            author_name = rest.to_string();
            continue;
        }
        if let Some(rest) = line.strip_prefix("author-mail ") {
            author_email = rest.trim_matches(|c| c == '<' || c == '>').to_string();
            continue;
        }
        if let Some(rest) = line.strip_prefix("author-time ") {
            author_time = rest.parse().unwrap_or(0);
            continue;
        }
        if let Some(content) = line.strip_prefix('\t') {
            line_in_group += 1;
            let line_number = group_start_line + line_in_group - 1;
            lines.push(BlameLine {
                line_number,
                short_sha: commit_sha.chars().take(7).collect(),
                commit_sha: commit_sha.clone(),
                author_name: author_name.clone(),
                author_email: author_email.clone(),
                committed_at: author_time,
                content: content.to_string(),
            });
        }
    }

    lines
}

fn parse_blame_header(line: &str) -> Option<(String, u32)> {
    let mut parts = line.split_whitespace();
    let sha = parts.next()?;
    if sha.len() != 40 || !sha.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    let _orig = parts.next()?;
    let result_line: u32 = parts.next()?.parse().ok()?;
    Some((sha.to_string(), result_line))
}

pub async fn list_commits(
    repo_path: &Path,
    ref_name: &str,
    kind: RefKind,
    limit: u32,
) -> anyhow::Result<Vec<CommitInfo>> {
    if !ref_exists_kind(repo_path, ref_name, kind).await? {
        return Ok(Vec::new());
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

/// Unix committer timestamp of the latest commit on a ref, if the ref exists.
pub async fn latest_commit_time(
    repo_path: &Path,
    ref_name: &str,
    kind: RefKind,
) -> anyhow::Result<Option<i64>> {
    Ok(list_commits(repo_path, ref_name, kind, 1)
        .await?
        .first()
        .map(|commit| commit.committed_at))
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
    let _ = crate::storage::ensure_bare_repo_refs_dirs(repo_path);
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

pub async fn compare_refs(
    repo_path: &Path,
    base_ref: &str,
    head_ref: &str,
) -> anyhow::Result<CompareResult> {
    let base_ref = base_ref.trim();
    let head_ref = head_ref.trim();

    if base_ref.is_empty() {
        anyhow::bail!("base ref is required");
    }
    if head_ref.is_empty() {
        anyhow::bail!("head ref is required");
    }

    let base_commit = resolve_commit_target(repo_path, base_ref).await?;
    let head_commit = resolve_commit_target(repo_path, head_ref).await?;

    let merge_base = git(repo_path, &["merge-base", &base_commit, &head_commit]).await?;

    let diff = git(
        repo_path,
        &[
            "diff",
            "--patch",
            "--no-color",
            &format!("{merge_base}...{head_commit}"),
        ],
    )
    .await
    .unwrap_or_default();

    let shortstat = git(
        repo_path,
        &["diff", "--shortstat", &format!("{merge_base}...{head_commit}")],
    )
    .await
    .unwrap_or_default();
    let (files_changed, insertions, deletions) = parse_shortstat(&shortstat);

    let log_output = git(
        repo_path,
        &[
            "log",
            &format!("{merge_base}..{head_commit}"),
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

    let mergeable = is_mergeable_write_tree(repo_path, &base_commit, &head_commit).await?;

    Ok(CompareResult {
        base: base_ref.to_string(),
        head: head_ref.to_string(),
        merge_base,
        diff,
        commits,
        files_changed,
        insertions,
        deletions,
        mergeable,
    })
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

    let mut result = compare_refs(repo_path, &base_ref, &head_ref).await?;
    result.base = base_branch.to_string();
    result.head = head_branch.to_string();
    Ok(result)
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
    async fn create_tag_annotated_uses_tag_creation_time_not_commit_time() {
        use std::process::Command as StdCommand;
        use tempfile::TempDir;

        let tmp = TempDir::new().unwrap();
        let worktree = tmp.path();
        let repo_path = worktree.join(".git");

        StdCommand::new("git")
            .current_dir(worktree)
            .args(["init", "-q"])
            .status()
            .unwrap();
        StdCommand::new("git")
            .current_dir(worktree)
            .args(["config", "user.email", "test@example.com"])
            .status()
            .unwrap();
        StdCommand::new("git")
            .current_dir(worktree)
            .args(["config", "user.name", "Test User"])
            .status()
            .unwrap();
        std::fs::write(worktree.join("file.txt"), "content").unwrap();
        StdCommand::new("git")
            .current_dir(worktree)
            .args(["add", "file.txt"])
            .status()
            .unwrap();
        StdCommand::new("git")
            .current_dir(worktree)
            .env("GIT_AUTHOR_DATE", "2024-01-01T00:00:00")
            .env("GIT_COMMITTER_DATE", "2024-01-01T00:00:00")
            .args(["commit", "-q", "-m", "old commit"])
            .status()
            .unwrap();

        let before = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;

        let tag = create_tag(
            &repo_path,
            "v1.0.0",
            "HEAD",
            Some("v1.0.0"),
            Some(TaggerIdentity {
                name: "Test User",
                email: "test@example.com",
            }),
        )
        .await
        .expect("create tag");

        let after = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;

        assert_eq!(tag.tagger_name, "Test User");
        assert!(
            tag.tagged_at >= before && tag.tagged_at <= after,
            "tagged_at should reflect tag creation time, got {}",
            tag.tagged_at
        );
        assert_ne!(
            tag.tagged_at, 1_704_042_000,
            "tagged_at should not use the old commit date"
        );
    }

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

    fn init_bare_repo_with_commit() -> (tempfile::TempDir, PathBuf) {
        use std::process::Command as StdCommand;
        let tmp = tempfile::TempDir::new().unwrap();
        let worktree = tmp.path().to_path_buf();
        StdCommand::new("git").current_dir(&worktree).args(["init", "-q"]).status().unwrap();
        StdCommand::new("git").current_dir(&worktree).args(["config", "user.email", "t@e.com"]).status().unwrap();
        StdCommand::new("git").current_dir(&worktree).args(["config", "user.name", "T"]).status().unwrap();
        std::fs::write(worktree.join("README.md"), "# hello").unwrap();
        StdCommand::new("git").current_dir(&worktree).args(["add", "README.md"]).status().unwrap();
        StdCommand::new("git").current_dir(&worktree).args(["commit", "-q", "-m", "init"]).status().unwrap();
        (tmp, worktree.join(".git"))
    }

    #[tokio::test]
    async fn repo_browser_lists_branches() {
        let (_tmp, repo_path) = init_bare_repo_with_commit();
        let browser = repo_browser(&repo_path, "main").await.unwrap();
        assert!(!browser.empty);
        assert!(browser.branches.contains(&"main".to_string()));
    }

    #[tokio::test]
    async fn list_tree_and_read_blob() {
        let (_tmp, repo_path) = init_bare_repo_with_commit();
        let entries = list_tree(&repo_path, "main", RefKind::Branch, "").await.unwrap();
        assert!(entries.iter().any(|e| e.name == "README.md"));
        let content = read_blob(&repo_path, "main", RefKind::Branch, "README.md")
            .await
            .unwrap();
        assert!(content.contains("hello"));
    }

    #[test]
    fn parse_blame_porcelain_groups_lines() {
        let output = "\
aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 1 1 2
author Alice
author-mail <alice@example.com>
author-time 1000
filename README.md
	# hello
	## world
bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb 1 3 1
author Bob
author-mail <bob@example.com>
author-time 2000
filename README.md
	footer
";
        let lines = parse_blame_porcelain(output);
        assert_eq!(lines.len(), 3);
        assert_eq!(lines[0].line_number, 1);
        assert_eq!(lines[0].short_sha, "aaaaaaa");
        assert_eq!(lines[0].author_name, "Alice");
        assert_eq!(lines[0].content, "# hello");
        assert_eq!(lines[1].line_number, 2);
        assert_eq!(lines[1].content, "## world");
        assert_eq!(lines[2].line_number, 3);
        assert_eq!(lines[2].author_name, "Bob");
    }

    #[tokio::test]
    async fn file_blame_returns_lines_for_text_file() {
        let (_tmp, repo_path) = init_bare_repo_with_commit();
        let lines = file_blame(&repo_path, "main", RefKind::Branch, "README.md")
            .await
            .unwrap();
        assert!(!lines.is_empty());
        assert!(lines[0].commit_sha.len() == 40);
        assert!(lines.iter().any(|line| line.content.contains("hello")));
    }

    #[tokio::test]
    async fn list_commits_and_get_commit() {
        let (_tmp, repo_path) = init_bare_repo_with_commit();
        let commits = list_commits(&repo_path, "main", RefKind::Branch, 5)
            .await
            .unwrap();
        assert_eq!(commits.len(), 1);
        let detail = get_commit(&repo_path, &commits[0].sha).await.unwrap();
        assert_eq!(detail.message, "init");
    }

    #[tokio::test]
    async fn branch_head_and_ref_checks() {
        let (_tmp, repo_path) = init_bare_repo_with_commit();
        let sha = branch_head_sha(&repo_path, "main").await.unwrap();
        assert_eq!(sha.len(), 40);
        assert!(ref_exists(&repo_path, "main").await.unwrap());
        assert!(ref_exists_kind(&repo_path, "main", RefKind::Branch)
            .await
            .unwrap());
    }

    #[tokio::test]
    async fn create_lightweight_tag() {
        let (_tmp, repo_path) = init_bare_repo_with_commit();
        let tag = create_tag(&repo_path, "v1", "HEAD", None, None).await.unwrap();
        assert_eq!(tag.name, "v1");
        assert!(tag_exists(&repo_path, "v1").await.unwrap());
    }

    #[tokio::test]
    async fn delete_tag_removes_ref() {
        let (_tmp, repo_path) = init_bare_repo_with_commit();
        create_tag(&repo_path, "v1", "HEAD", None, None).await.unwrap();
        delete_tag(&repo_path, "v1").await.unwrap();
        assert!(!tag_exists(&repo_path, "v1").await.unwrap());
    }

    #[tokio::test]
    async fn update_tag_can_rename_and_retarget() {
        let (_tmp, repo_path) = init_bare_repo_with_commit();
        create_tag(
            &repo_path,
            "v1",
            "HEAD",
            Some("first release"),
            Some(TaggerIdentity {
                name: "Tester",
                email: "test@example.com",
            }),
        )
        .await
        .unwrap();

        let updated = update_tag(
            &repo_path,
            "v1",
            Some("v1.0.0"),
            Some("HEAD"),
            Some("renamed release"),
            Some(TaggerIdentity {
                name: "Tester",
                email: "test@example.com",
            }),
        )
        .await
        .unwrap();

        assert_eq!(updated.name, "v1.0.0");
        assert!(!tag_exists(&repo_path, "v1").await.unwrap());
        assert!(tag_exists(&repo_path, "v1.0.0").await.unwrap());
        assert_eq!(updated.message, "renamed release");
    }

    #[tokio::test]
    async fn compare_branch_to_itself_is_empty() {
        let (_tmp, repo_path) = init_bare_repo_with_commit();
        let result = compare_branches(&repo_path, "main", "main").await.unwrap();
        assert!(result.commits.is_empty());
    }

    #[tokio::test]
    async fn list_branch_details_populated() {
        let (_tmp, repo_path) = init_bare_repo_with_commit();
        let branches = list_branch_details(&repo_path).await.unwrap();
        assert_eq!(branches.len(), 1);
        assert_eq!(branches[0].name, "main");
        let detail = get_commit(&repo_path, &branches[0].sha).await.unwrap();
        assert_eq!(detail.message, "init");
    }

    #[test]
    fn validate_branch_name_rejects_invalid() {
        assert!(validate_branch_name("").is_err());
        assert!(validate_branch_name("bad name").is_err());
        assert!(validate_branch_name("bad..name").is_err());
        assert!(validate_branch_name("feature/foo").is_ok());
    }

    #[test]
    fn validate_tag_name_rejects_slashes() {
        assert!(validate_tag_name("v1/0").is_err());
        assert!(validate_tag_name("v1.0.0").is_ok());
    }

    #[test]
    fn parse_shortstat_extracts_counts() {
        let stat = " README.md | 1 +\n 1 file changed, 1 insertion(+), 0 deletions(-)";
        assert_eq!(parse_shortstat(stat), (1, 1, 0));
    }

    #[test]
    fn parse_ls_tree_line_parses_blob() {
        let line = "100644 blob deadbeef 42\tREADME.md";
        let entry = parse_ls_tree_line(line, "src/").unwrap();
        assert_eq!(entry.name, "README.md");
        assert_eq!(entry.path, "src/README.md");
        assert_eq!(entry.size, Some(42));
    }

    #[test]
    fn format_git_failure_prefers_stderr() {
        use std::process::Output;
        let output = Output {
            status: std::process::Command::new("false")
                .status()
                .unwrap(),
            stdout: b"stdout".to_vec(),
            stderr: b"stderr".to_vec(),
        };
        assert_eq!(
            format_git_failure(&output, "merge failed"),
            "merge failed: stderr; stdout"
        );
    }

    #[test]
    fn format_git_failure_stdout_only_and_status_only() {
        use std::process::Output;
        let stdout_only = Output {
            status: std::process::Command::new("false").status().unwrap(),
            stdout: b"stdout".to_vec(),
            stderr: Vec::new(),
        };
        assert_eq!(
            format_git_failure(&stdout_only, "failed"),
            "failed: stdout"
        );
        let silent = Output {
            status: std::process::Command::new("false").status().unwrap(),
            stdout: Vec::new(),
            stderr: Vec::new(),
        };
        assert!(format_git_failure(&silent, "failed").contains("git exited"));
    }

    #[test]
    fn validate_branch_name_rejects_too_long() {
        assert!(validate_branch_name(&"a".repeat(256)).is_err());
    }

    #[test]
    fn validate_tag_name_rejects_too_long() {
        assert!(validate_tag_name(&"v".repeat(256)).is_err());
    }

    #[tokio::test]
    async fn list_tree_with_subdirectory_path() {
        let (_tmp, repo_path) = init_bare_repo_with_commit();
        let entries = list_tree(&repo_path, "main", RefKind::Branch, "").await.unwrap();
        assert!(!entries.is_empty());
    }

    #[test]
    fn git_output_indicates_conflict_detects_markers() {
        use std::process::Output;
        let conflict = Output {
            status: std::process::Command::new("true").status().unwrap(),
            stdout: Vec::new(),
            stderr: b"CONFLICT (content): Merge conflict in file".to_vec(),
        };
        assert!(git_output_indicates_conflict(&conflict));
        let clean = Output {
            status: std::process::Command::new("true").status().unwrap(),
            stdout: Vec::new(),
            stderr: b"Already up to date.".to_vec(),
        };
        assert!(!git_output_indicates_conflict(&clean));
    }
}
