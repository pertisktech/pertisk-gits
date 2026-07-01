use std::collections::HashMap;

use anyhow::Context;
use chrono::{DateTime, Utc};
use pertisk_domain::models::ImportProvider;
use serde::Deserialize;
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Debug, Default, Clone, Copy)]
pub struct MetadataImportOptions {
    pub import_issues: bool,
    pub import_pull_requests: bool,
}

#[derive(Debug, Default)]
pub struct MetadataStats {
    pub labels: u32,
    pub milestones: u32,
    pub issues: u32,
    pub pull_requests: u32,
}

pub async fn import_repo_metadata(
    pool: &PgPool,
    provider: ImportProvider,
    token: &str,
    base_url: &str,
    source_full_name: &str,
    repository_id: Uuid,
    author_id: Uuid,
    options: MetadataImportOptions,
) -> anyhow::Result<MetadataStats> {
    match provider {
        ImportProvider::Github => {
            import_github_metadata(
                pool,
                token,
                base_url,
                source_full_name,
                repository_id,
                author_id,
                options,
            )
            .await
        }
        ImportProvider::Gitlab => {
            import_gitlab_metadata(
                pool,
                token,
                base_url,
                source_full_name,
                repository_id,
                author_id,
                options,
            )
            .await
        }
    }
}

async fn import_github_metadata(
    pool: &PgPool,
    token: &str,
    base_url: &str,
    source_full_name: &str,
    repository_id: Uuid,
    author_id: Uuid,
    options: MetadataImportOptions,
) -> anyhow::Result<MetadataStats> {
    let (owner, repo) = split_full_name(source_full_name)?;
    let api = github_api_base(base_url);
    let client = http_client()?;
    let repo_path = format!("{api}/repos/{owner}/{repo}");

    let mut stats = MetadataStats::default();

    if options.import_issues {
        import_github_issues(
            pool,
            &client,
            token,
            &repo_path,
            repository_id,
            author_id,
            &mut stats,
        )
        .await?;
    }

    if options.import_pull_requests {
        import_github_pull_requests(
            pool,
            &client,
            token,
            &repo_path,
            repository_id,
            author_id,
            &mut stats,
        )
        .await?;
    }

    Ok(stats)
}

async fn import_github_issues(
    pool: &PgPool,
    client: &reqwest::Client,
    token: &str,
    repo_path: &str,
    repository_id: Uuid,
    author_id: Uuid,
    stats: &mut MetadataStats,
) -> anyhow::Result<()> {
    let labels: Vec<GithubLabel> =
        paginate_github(&client, token, &format!("{repo_path}/labels"), 100, false).await?;
    let mut label_ids: HashMap<String, Uuid> = HashMap::new();
    for label in labels {
        let color = normalize_color(&label.color);
        let id = upsert_label(
            pool,
            repository_id,
            &label.name,
            &color,
            label.description.as_deref(),
        )
        .await?;
        label_ids.insert(label.name, id);
        stats.labels += 1;
    }

    let milestones: Vec<GithubMilestone> =
        paginate_github(&client, token, &format!("{repo_path}/milestones"), 100, true).await?;
    let mut milestone_ids: HashMap<i64, Uuid> = HashMap::new();
    for ms in milestones {
        let state = if ms.state == "closed" { "closed" } else { "open" };
        let id = upsert_milestone(
            pool,
            repository_id,
            &ms.title,
            ms.description.as_deref(),
            ms.due_on.as_deref(),
            state,
        )
        .await?;
        milestone_ids.insert(ms.number, id);
        stats.milestones += 1;
    }

    let issues: Vec<GithubIssue> =
        paginate_github(&client, token, &format!("{repo_path}/issues"), 100, true).await?;

    let mut max_issue_number = 0i32;
    for issue in issues {
        if issue.pull_request.is_some() {
            continue;
        }
        let number = issue.number;
        max_issue_number = max_issue_number.max(number);
        let state = if issue.state == "closed" { "closed" } else { "open" };
        let milestone_id = issue
            .milestone
            .as_ref()
            .and_then(|ms| milestone_ids.get(&ms.number).copied());
        let issue_id = upsert_issue(
            pool,
            repository_id,
            number,
            author_id,
            milestone_id,
            &issue.title,
            issue.body.as_deref().unwrap_or(""),
            state,
            issue.created_at,
            issue.closed_at,
        )
        .await?;
        for label in issue.labels {
            if let Some(label_id) = label_ids.get(&label.name) {
                link_issue_label(pool, issue_id, *label_id).await?;
            }
        }
        stats.issues += 1;
    }

    if max_issue_number > 0 {
        bump_issue_counter(pool, repository_id, max_issue_number + 1).await?;
    }

    Ok(())
}

async fn import_github_pull_requests(
    pool: &PgPool,
    client: &reqwest::Client,
    token: &str,
    repo_path: &str,
    repository_id: Uuid,
    author_id: Uuid,
    stats: &mut MetadataStats,
) -> anyhow::Result<()> {
    let pulls: Vec<GithubPull> =
        paginate_github_open(&client, token, &format!("{repo_path}/pulls"), 100).await?;

    let mut max_pull_number = 0i32;
    for pull in pulls {
        if pull.source_branch() == pull.target_branch() {
            continue;
        }
        let number = pull.number;
        max_pull_number = max_pull_number.max(number);
        upsert_pull_request(
            pool,
            repository_id,
            number,
            author_id,
            &pull.title,
            pull.body.as_deref().unwrap_or(""),
            pull.source_branch(),
            pull.target_branch(),
            pull.created_at,
        )
        .await?;
        stats.pull_requests += 1;
    }

    if max_pull_number > 0 {
        bump_pull_counter(pool, repository_id, max_pull_number + 1).await?;
    }

    Ok(())
}

async fn import_gitlab_metadata(
    pool: &PgPool,
    token: &str,
    base_url: &str,
    source_full_name: &str,
    repository_id: Uuid,
    author_id: Uuid,
    options: MetadataImportOptions,
) -> anyhow::Result<MetadataStats> {
    let api = gitlab_api_base(base_url);
    let project = urlencoding::encode(source_full_name);
    let client = http_client()?;
    let project_path = format!("{api}/projects/{project}");

    let mut stats = MetadataStats::default();

    if options.import_issues {
        import_gitlab_issues(
            pool,
            &client,
            token,
            &project_path,
            repository_id,
            author_id,
            &mut stats,
        )
        .await?;
    }

    if options.import_pull_requests {
        import_gitlab_merge_requests(
            pool,
            &client,
            token,
            &project_path,
            repository_id,
            author_id,
            &mut stats,
        )
        .await?;
    }

    Ok(stats)
}

async fn import_gitlab_issues(
    pool: &PgPool,
    client: &reqwest::Client,
    token: &str,
    project_path: &str,
    repository_id: Uuid,
    author_id: Uuid,
    stats: &mut MetadataStats,
) -> anyhow::Result<()> {
    let labels: Vec<GitlabLabel> =
        paginate_gitlab(&client, token, &format!("{project_path}/labels"), 100).await?;
    let mut label_ids: HashMap<String, Uuid> = HashMap::new();
    for label in labels {
        let color = normalize_color(&label.color);
        let id = upsert_label(pool, repository_id, &label.name, &color, None).await?;
        label_ids.insert(label.name, id);
        stats.labels += 1;
    }

    let milestones: Vec<GitlabMilestone> =
        paginate_gitlab(&client, token, &format!("{project_path}/milestones"), 100).await?;
    let mut milestone_ids: HashMap<i64, Uuid> = HashMap::new();
    for ms in milestones {
        let state = if ms.state == "closed" { "closed" } else { "open" };
        let id = upsert_milestone(
            pool,
            repository_id,
            &ms.title,
            ms.description.as_deref(),
            ms.due_date.as_deref(),
            state,
        )
        .await?;
        milestone_ids.insert(ms.iid as i64, id);
        stats.milestones += 1;
    }

    let issues: Vec<GitlabIssue> =
        paginate_gitlab(&client, token, &format!("{project_path}/issues"), 100).await?;

    let mut max_issue_number = 0i32;
    for issue in issues {
        let number = issue.iid;
        max_issue_number = max_issue_number.max(number);
        let state = if issue.state == "closed" { "closed" } else { "open" };
        let milestone_id = issue
            .milestone
            .as_ref()
            .and_then(|ms| milestone_ids.get(&(ms.iid as i64)).copied());
        let issue_id = upsert_issue(
            pool,
            repository_id,
            number,
            author_id,
            milestone_id,
            &issue.title,
            issue.description.as_deref().unwrap_or(""),
            state,
            issue.created_at,
            issue.closed_at,
        )
        .await?;
        for label in issue.labels {
            if let Some(label_id) = label_ids.get(&label) {
                link_issue_label(pool, issue_id, *label_id).await?;
            }
        }
        stats.issues += 1;
    }

    if max_issue_number > 0 {
        bump_issue_counter(pool, repository_id, max_issue_number + 1).await?;
    }

    Ok(())
}

async fn import_gitlab_merge_requests(
    pool: &PgPool,
    client: &reqwest::Client,
    token: &str,
    project_path: &str,
    repository_id: Uuid,
    author_id: Uuid,
    stats: &mut MetadataStats,
) -> anyhow::Result<()> {
    let mrs: Vec<GitlabMergeRequest> = paginate_gitlab_open(
        client,
        token,
        &format!("{project_path}/merge_requests"),
        100,
    )
    .await?;

    let mut max_pull_number = 0i32;
    for mr in mrs {
        if mr.source_branch == mr.target_branch {
            continue;
        }
        let number = mr.iid;
        max_pull_number = max_pull_number.max(number);
        upsert_pull_request(
            pool,
            repository_id,
            number,
            author_id,
            &mr.title,
            mr.description.as_deref().unwrap_or(""),
            &mr.source_branch,
            &mr.target_branch,
            mr.created_at,
        )
        .await?;
        stats.pull_requests += 1;
    }

    if max_pull_number > 0 {
        bump_pull_counter(pool, repository_id, max_pull_number + 1).await?;
    }

    Ok(())
}

async fn paginate_github_open<T: for<'de> Deserialize<'de>>(
    client: &reqwest::Client,
    token: &str,
    url: &str,
    per_page: u32,
) -> anyhow::Result<Vec<T>> {
    let mut all = Vec::new();
    let mut page = 1u32;
    loop {
        let response = client
            .get(url)
            .query(&[
                ("per_page", per_page.to_string()),
                ("page", page.to_string()),
                ("state", "open".to_string()),
            ])
            .header("Authorization", format!("Bearer {token}"))
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .send()
            .await
            .with_context(|| format!("github GET {url}"))?;
        if !response.status().is_success() {
            anyhow::bail!(
                "github API {}: {}",
                response.status(),
                response.text().await.unwrap_or_default()
            );
        }
        let batch: Vec<T> = response.json().await?;
        let len = batch.len();
        all.extend(batch);
        if len < per_page as usize || page >= 20 {
            break;
        }
        page += 1;
    }
    Ok(all)
}

async fn paginate_github<T: for<'de> Deserialize<'de>>(
    client: &reqwest::Client,
    token: &str,
    url: &str,
    per_page: u32,
    state_all: bool,
) -> anyhow::Result<Vec<T>> {
    let mut all = Vec::new();
    let mut page = 1u32;
    loop {
        let mut request = client
            .get(url)
            .query(&[
                ("per_page", per_page.to_string()),
                ("page", page.to_string()),
            ]);
        if state_all {
            request = request.query(&[("state", "all".to_string())]);
        }
        let response = request
            .header("Authorization", format!("Bearer {token}"))
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .send()
            .await
            .with_context(|| format!("github GET {url}"))?;
        if !response.status().is_success() {
            anyhow::bail!(
                "github API {}: {}",
                response.status(),
                response.text().await.unwrap_or_default()
            );
        }
        let batch: Vec<T> = response.json().await?;
        let len = batch.len();
        all.extend(batch);
        if len < per_page as usize || page >= 20 {
            break;
        }
        page += 1;
    }
    Ok(all)
}

async fn paginate_gitlab_open<T: for<'de> Deserialize<'de>>(
    client: &reqwest::Client,
    token: &str,
    url: &str,
    per_page: u32,
) -> anyhow::Result<Vec<T>> {
    let mut all = Vec::new();
    let mut page = 1u32;
    loop {
        let response = client
            .get(url)
            .query(&[
                ("per_page", per_page.to_string()),
                ("page", page.to_string()),
                ("state", "opened".to_string()),
            ])
            .header("PRIVATE-TOKEN", token)
            .send()
            .await
            .with_context(|| format!("gitlab GET {url}"))?;
        if !response.status().is_success() {
            anyhow::bail!(
                "gitlab API {}: {}",
                response.status(),
                response.text().await.unwrap_or_default()
            );
        }
        let batch: Vec<T> = response.json().await?;
        let len = batch.len();
        all.extend(batch);
        if len < per_page as usize || page >= 20 {
            break;
        }
        page += 1;
    }
    Ok(all)
}

async fn paginate_gitlab<T: for<'de> Deserialize<'de>>(
    client: &reqwest::Client,
    token: &str,
    url: &str,
    per_page: u32,
) -> anyhow::Result<Vec<T>> {
    let mut all = Vec::new();
    let mut page = 1u32;
    loop {
        let response = client
            .get(url)
            .query(&[
                ("per_page", per_page.to_string()),
                ("page", page.to_string()),
            ])
            .header("PRIVATE-TOKEN", token)
            .send()
            .await
            .with_context(|| format!("gitlab GET {url}"))?;
        if !response.status().is_success() {
            anyhow::bail!(
                "gitlab API {}: {}",
                response.status(),
                response.text().await.unwrap_or_default()
            );
        }
        let batch: Vec<T> = response.json().await?;
        let len = batch.len();
        all.extend(batch);
        if len < per_page as usize || page >= 20 {
            break;
        }
        page += 1;
    }
    Ok(all)
}

async fn upsert_label(
    pool: &PgPool,
    repository_id: Uuid,
    name: &str,
    color: &str,
    description: Option<&str>,
) -> anyhow::Result<Uuid> {
    Ok(sqlx::query_scalar(
        r#"
        INSERT INTO labels (repository_id, name, color, description)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (repository_id, name)
        DO UPDATE SET
            color = EXCLUDED.color,
            description = COALESCE(EXCLUDED.description, labels.description)
        RETURNING id
        "#,
    )
    .bind(repository_id)
    .bind(name)
    .bind(color)
    .bind(description)
    .fetch_one(pool)
    .await?)
}

async fn upsert_milestone(
    pool: &PgPool,
    repository_id: Uuid,
    title: &str,
    description: Option<&str>,
    due_on: Option<&str>,
    state: &str,
) -> anyhow::Result<Uuid> {
    if let Some(existing) = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM milestones WHERE repository_id = $1 AND title = $2",
    )
    .bind(repository_id)
    .bind(title)
    .fetch_optional(pool)
    .await?
    {
        return Ok(existing);
    }
    let due = due_on.and_then(|d| chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d").ok());
    Ok(sqlx::query_scalar(
        r#"
        INSERT INTO milestones (repository_id, title, description, due_on, state)
        VALUES ($1, $2, $3, $4, $5::milestone_state)
        RETURNING id
        "#,
    )
    .bind(repository_id)
    .bind(title)
    .bind(description)
    .bind(due)
    .bind(state)
    .fetch_one(pool)
    .await?)
}

async fn upsert_issue(
    pool: &PgPool,
    repository_id: Uuid,
    number: i32,
    author_id: Uuid,
    milestone_id: Option<Uuid>,
    title: &str,
    body: &str,
    state: &str,
    created_at: DateTime<Utc>,
    closed_at: Option<DateTime<Utc>>,
) -> anyhow::Result<Uuid> {
    Ok(sqlx::query_scalar(
        r#"
        INSERT INTO issues (
            repository_id, number, author_id, milestone_id, title, body, state, created_at, closed_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::issue_state, $8, $9)
        ON CONFLICT (repository_id, number) DO UPDATE SET
            title = EXCLUDED.title,
            body = EXCLUDED.body,
            state = EXCLUDED.state,
            milestone_id = EXCLUDED.milestone_id,
            closed_at = EXCLUDED.closed_at
        RETURNING id
        "#,
    )
    .bind(repository_id)
    .bind(number)
    .bind(author_id)
    .bind(milestone_id)
    .bind(title)
    .bind(body)
    .bind(state)
    .bind(created_at)
    .bind(closed_at)
    .fetch_one(pool)
    .await?)
}

async fn link_issue_label(pool: &PgPool, issue_id: Uuid, label_id: Uuid) -> anyhow::Result<()> {
    sqlx::query(
        r#"
        INSERT INTO issue_labels (issue_id, label_id)
        VALUES ($1, $2)
        ON CONFLICT DO NOTHING
        "#,
    )
    .bind(issue_id)
    .bind(label_id)
    .execute(pool)
    .await?;
    Ok(())
}

async fn bump_issue_counter(pool: &PgPool, repository_id: Uuid, next: i32) -> anyhow::Result<()> {
    sqlx::query(
        r#"
        INSERT INTO repository_counters (repository_id, next_issue_number)
        VALUES ($1, $2)
        ON CONFLICT (repository_id)
        DO UPDATE SET next_issue_number = GREATEST(repository_counters.next_issue_number, EXCLUDED.next_issue_number)
        "#,
    )
    .bind(repository_id)
    .bind(next)
    .execute(pool)
    .await?;
    Ok(())
}

async fn upsert_pull_request(
    pool: &PgPool,
    repository_id: Uuid,
    number: i32,
    author_id: Uuid,
    title: &str,
    body: &str,
    source_branch: &str,
    target_branch: &str,
    created_at: DateTime<Utc>,
) -> anyhow::Result<()> {
    sqlx::query(
        r#"
        INSERT INTO pull_requests (
            repository_id, number, author_id, title, body, source_branch, target_branch, state, created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'open', $8)
        ON CONFLICT (repository_id, number) DO UPDATE SET
            title = EXCLUDED.title,
            body = EXCLUDED.body,
            source_branch = EXCLUDED.source_branch,
            target_branch = EXCLUDED.target_branch,
            state = 'open',
            updated_at = NOW()
        "#,
    )
    .bind(repository_id)
    .bind(number)
    .bind(author_id)
    .bind(title)
    .bind(body)
    .bind(source_branch)
    .bind(target_branch)
    .bind(created_at)
    .execute(pool)
    .await?;
    Ok(())
}

async fn bump_pull_counter(pool: &PgPool, repository_id: Uuid, next: i32) -> anyhow::Result<()> {
    sqlx::query(
        r#"
        INSERT INTO repository_counters (repository_id, next_pull_number)
        VALUES ($1, $2)
        ON CONFLICT (repository_id)
        DO UPDATE SET next_pull_number = GREATEST(repository_counters.next_pull_number, EXCLUDED.next_pull_number)
        "#,
    )
    .bind(repository_id)
    .bind(next)
    .execute(pool)
    .await?;
    Ok(())
}

fn split_full_name(full_name: &str) -> anyhow::Result<(&str, &str)> {
    let (owner, repo) = full_name
        .split_once('/')
        .ok_or_else(|| anyhow::anyhow!("invalid repository name: {full_name}"))?;
    Ok((owner, repo))
}

fn normalize_color(color: &str) -> String {
    if color.starts_with('#') {
        color.to_string()
    } else {
        format!("#{color}")
    }
}

fn github_api_base(base_url: &str) -> String {
    let base = base_url.trim_end_matches('/');
    if base.contains("api.github.com") {
        return base.to_string();
    }
    if matches!(base, "https://github.com" | "http://github.com") {
        return "https://api.github.com".to_string();
    }
    format!("{base}/api/v3")
}

fn gitlab_api_base(base_url: &str) -> String {
    format!("{}/api/v4", base_url.trim_end_matches('/'))
}

fn http_client() -> anyhow::Result<reqwest::Client> {
    let mut builder = reqwest::Client::builder().user_agent("pertisk-gits-import");
    if import_tls_insecure() {
        builder = builder.danger_accept_invalid_certs(true);
    }
    builder.build().context("build http client")
}

fn import_tls_insecure() -> bool {
    matches!(
        std::env::var("IMPORT_TLS_INSECURE").ok().as_deref(),
        Some("1") | Some("true") | Some("TRUE") | Some("yes") | Some("YES")
    )
}

#[derive(Debug, Deserialize)]
struct GithubLabel {
    name: String,
    color: String,
    description: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GithubMilestone {
    number: i64,
    title: String,
    description: Option<String>,
    state: String,
    due_on: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GithubIssue {
    number: i32,
    title: String,
    body: Option<String>,
    state: String,
    created_at: DateTime<Utc>,
    closed_at: Option<DateTime<Utc>>,
    labels: Vec<GithubLabel>,
    milestone: Option<GithubMilestoneRef>,
    pull_request: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct GithubMilestoneRef {
    number: i64,
}

#[derive(Debug, Deserialize)]
struct GitlabLabel {
    name: String,
    color: String,
}

#[derive(Debug, Deserialize)]
struct GitlabMilestone {
    iid: i32,
    title: String,
    description: Option<String>,
    state: String,
    due_date: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GitlabMilestoneRef {
    iid: i32,
}

#[derive(Debug, Deserialize)]
struct GitlabIssue {
    iid: i32,
    title: String,
    description: Option<String>,
    state: String,
    created_at: DateTime<Utc>,
    closed_at: Option<DateTime<Utc>>,
    labels: Vec<String>,
    milestone: Option<GitlabMilestoneRef>,
}

#[derive(Debug, Deserialize)]
struct GithubPull {
    number: i32,
    title: String,
    body: Option<String>,
    created_at: DateTime<Utc>,
    head: GithubPullRef,
    base: GithubPullRef,
}

#[derive(Debug, Deserialize)]
struct GithubPullRef {
    r#ref: String,
}

impl GithubPull {
    fn source_branch(&self) -> &str {
        &self.head.r#ref
    }

    fn target_branch(&self) -> &str {
        &self.base.r#ref
    }
}

#[derive(Debug, Deserialize)]
struct GitlabMergeRequest {
    iid: i32,
    title: String,
    description: Option<String>,
    source_branch: String,
    target_branch: String,
    created_at: DateTime<Utc>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_full_name_parses_owner_repo() {
        assert_eq!(split_full_name("acme/widget").unwrap(), ("acme", "widget"));
        assert!(split_full_name("widget").is_err());
    }

    #[test]
    fn normalize_color_adds_hash_prefix() {
        assert_eq!(normalize_color("ff00aa"), "#ff00aa");
        assert_eq!(normalize_color("#abc"), "#abc");
    }

    #[test]
    fn github_api_base_maps_public_github() {
        assert_eq!(
            github_api_base("https://github.com"),
            "https://api.github.com"
        );
        assert_eq!(
            github_api_base("https://git.example.com"),
            "https://git.example.com/api/v3"
        );
        assert_eq!(
            github_api_base("https://api.github.com"),
            "https://api.github.com"
        );
    }

    #[test]
    fn gitlab_api_base_appends_v4_path() {
        assert_eq!(
            gitlab_api_base("https://gitlab.com/"),
            "https://gitlab.com/api/v4"
        );
    }

    #[test]
    fn import_tls_insecure_reads_env() {
        let prev = std::env::var("IMPORT_TLS_INSECURE").ok();

        for value in ["true", "1", "yes", "TRUE", "YES"] {
            std::env::set_var("IMPORT_TLS_INSECURE", value);
            assert!(import_tls_insecure(), "expected true for {value}");
        }

        std::env::remove_var("IMPORT_TLS_INSECURE");
        assert!(!import_tls_insecure());

        if let Some(value) = prev {
            std::env::set_var("IMPORT_TLS_INSECURE", value);
        }
    }

    #[test]
    fn github_api_base_maps_http_github() {
        assert_eq!(
            github_api_base("http://github.com"),
            "https://api.github.com"
        );
    }

    #[test]
    fn http_client_builds() {
        http_client().unwrap();
    }
}
