use anyhow::Context;
use pertisk_domain::models::{ImportProvider, RepoVisibility};
use serde::Deserialize;

#[derive(Debug, Clone, serde::Serialize)]
pub struct RemoteNamespace {
    pub id: String,
    /// Org login, GitLab group path, or user login for personal repos.
    pub path: String,
    pub name: String,
    /// `personal`, `organization`, or `group`
    pub kind: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct RemoteRepo {
    pub id: String,
    pub full_name: String,
    pub name: String,
    pub description: Option<String>,
    pub visibility: RepoVisibility,
    pub default_branch: String,
    pub clone_url: String,
    #[serde(default)]
    pub already_exists: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub existing_path: Option<String>,
}

pub fn default_base_url(provider: ImportProvider) -> &'static str {
    match provider {
        ImportProvider::Github => "https://github.com",
        ImportProvider::Gitlab => "https://gitlab.com",
    }
}

pub fn normalize_base_url(provider: ImportProvider, base_url: Option<&str>) -> String {
    let raw = base_url
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| default_base_url(provider));
    raw.trim_end_matches('/').to_string()
}

pub fn normalize_token(token: &str) -> String {
    token.trim().to_string()
}

/// GitHub.com REST API lives on api.github.com; Enterprise Server uses {host}/api/v3.
pub fn github_api_base(base_url: &str) -> String {
    let base = base_url.trim_end_matches('/');
    if base.contains("api.github.com") {
        return base.to_string();
    }
    if matches!(base, "https://github.com" | "http://github.com") {
        return "https://api.github.com".to_string();
    }
    format!("{base}/api/v3")
}

pub fn api_base(provider: ImportProvider, base_url: &str) -> String {
    match provider {
        ImportProvider::Github => github_api_base(base_url),
        ImportProvider::Gitlab => format!("{}/api/v4", base_url.trim_end_matches('/')),
    }
}

pub fn slug_from_name(name: &str) -> String {
    let mut slug = name
        .trim()
        .to_ascii_lowercase()
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else if c == ' ' || c == '.' {
                '-'
            } else {
                '-'
            }
        })
        .collect::<String>();
    while slug.contains("--") {
        slug = slug.replace("--", "-");
    }
    slug.trim_matches('-').chars().take(100).collect()
}

pub async fn validate_token(
    provider: ImportProvider,
    token: &str,
    base_url: &str,
) -> anyhow::Result<String> {
    let token = normalize_token(token);
    if token.is_empty() {
        anyhow::bail!("personal access token is required");
    }
    match provider {
        ImportProvider::Github => validate_github_token(&token, base_url).await,
        ImportProvider::Gitlab => validate_gitlab_token(&token, base_url).await,
    }
}

pub async fn list_remote_namespaces(
    provider: ImportProvider,
    token: &str,
    base_url: &str,
    account: &str,
) -> anyhow::Result<Vec<RemoteNamespace>> {
    let token = normalize_token(token);
    match provider {
        ImportProvider::Github => list_github_namespaces(&token, base_url, account).await,
        ImportProvider::Gitlab => list_gitlab_namespaces(&token, base_url, account).await,
    }
}

pub struct NamespaceFilter<'a> {
    pub path: &'a str,
    pub kind: &'a str,
}

pub async fn list_remote_repos(
    provider: ImportProvider,
    token: &str,
    base_url: &str,
    namespace: Option<NamespaceFilter<'_>>,
) -> anyhow::Result<Vec<RemoteRepo>> {
    let token = normalize_token(token);
    match provider {
        ImportProvider::Github => list_github_repos(&token, base_url, namespace).await,
        ImportProvider::Gitlab => list_gitlab_repos(&token, base_url, namespace).await,
    }
}

async fn validate_github_token(token: &str, base_url: &str) -> anyhow::Result<String> {
    let client = http_client()?;
    let api = api_base(ImportProvider::Github, base_url);
    let response = github_get(&client, &format!("{api}/user"), token)
        .send()
        .await
        .context("github user request failed")?;

    if !response.status().is_success() {
        return Err(github_auth_error(response).await);
    }

    let body: GithubUser = response.json().await.context("parse github user")?;
    Ok(body.login)
}

async fn validate_gitlab_token(token: &str, base_url: &str) -> anyhow::Result<String> {
    let client = http_client()?;
    let api = api_base(ImportProvider::Gitlab, base_url);
    let response = client
        .get(format!("{api}/user"))
        .header("PRIVATE-TOKEN", token)
        .send()
        .await
        .context("gitlab user request failed")?;

    if !response.status().is_success() {
        anyhow::bail!("invalid GitLab token or insufficient permissions");
    }

    let body: GitlabUser = response.json().await.context("parse gitlab user")?;
    Ok(body.username)
}

async fn list_github_namespaces(
    token: &str,
    base_url: &str,
    account: &str,
) -> anyhow::Result<Vec<RemoteNamespace>> {
    let client = http_client()?;
    let api = api_base(ImportProvider::Github, base_url);
    let mut namespaces = vec![RemoteNamespace {
        id: account.to_string(),
        path: account.to_string(),
        name: format!("{account} (personal)"),
        kind: "personal".into(),
    }];

    let mut page = 1u32;
    loop {
        let response = github_get(&client, &format!("{api}/user/orgs"), token)
            .query(&[("per_page", "100"), ("page", &page.to_string())])
            .send()
            .await
            .context("github orgs request failed")?;

        if !response.status().is_success() {
            return Err(github_auth_error(response).await);
        }

        let orgs: Vec<GithubOrg> = response.json().await.context("parse github orgs")?;
        if orgs.is_empty() {
            break;
        }

        let page_len = orgs.len();
        for org in orgs {
            namespaces.push(RemoteNamespace {
                id: org.id.to_string(),
                path: org.login.clone(),
                name: org.login,
                kind: "organization".into(),
            });
        }

        if page_len < 100 {
            break;
        }
        page += 1;
        if page > 20 {
            break;
        }
    }

    namespaces.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(namespaces)
}

async fn list_gitlab_namespaces(
    token: &str,
    base_url: &str,
    account: &str,
) -> anyhow::Result<Vec<RemoteNamespace>> {
    let client = http_client()?;
    let api = api_base(ImportProvider::Gitlab, base_url);
    let mut namespaces = vec![RemoteNamespace {
        id: account.to_string(),
        path: account.to_string(),
        name: format!("{account} (personal)"),
        kind: "personal".into(),
    }];

    let mut page = 1u32;
    loop {
        let response = client
            .get(format!("{api}/groups"))
            .query(&[
                ("min_access_level", "10"),
                ("per_page", "100"),
                ("page", &page.to_string()),
            ])
            .header("PRIVATE-TOKEN", token)
            .send()
            .await
            .context("gitlab groups request failed")?;

        if !response.status().is_success() {
            anyhow::bail!("failed to list GitLab groups");
        }

        let groups: Vec<GitlabGroup> = response.json().await.context("parse gitlab groups")?;
        if groups.is_empty() {
            break;
        }

        let page_len = groups.len();
        for group in groups {
            namespaces.push(RemoteNamespace {
                id: group.id.to_string(),
                path: group.full_path,
                name: group.name,
                kind: "group".into(),
            });
        }

        if page_len < 100 {
            break;
        }
        page += 1;
        if page > 20 {
            break;
        }
    }

    namespaces.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(namespaces)
}

async fn list_github_repos(
    token: &str,
    base_url: &str,
    namespace: Option<NamespaceFilter<'_>>,
) -> anyhow::Result<Vec<RemoteRepo>> {
    let client = http_client()?;
    let api = api_base(ImportProvider::Github, base_url);

    if let Some(ns) = namespace {
        if ns.kind == "personal" {
            return list_github_personal_repos(&client, token, &api, base_url, ns.path).await;
        }
        return list_github_org_repos(&client, token, &api, base_url, ns.path).await;
    }

    let mut repos = Vec::new();
    let mut page = 1u32;

    loop {
        let response = github_get(&client, &format!("{api}/user/repos"), token)
            .query(&[
                ("per_page", "100"),
                ("page", &page.to_string()),
                ("affiliation", "owner,collaborator,organization_member"),
            ])
            .send()
            .await
            .context("github repos request failed")?;

        if !response.status().is_success() {
            return Err(github_auth_error(response).await);
        }

        let page_repos: Vec<GithubRepo> = response.json().await.context("parse github repos")?;
        if page_repos.is_empty() {
            break;
        }

        let page_len = page_repos.len();
        for repo in page_repos {
            let clone_url = repo
                .clone_url
                .or(repo.git_url)
                .unwrap_or_else(|| format!("{base_url}/{}/{}.git", repo.owner.login, repo.name));
            repos.push(RemoteRepo {
                id: repo.id.to_string(),
                full_name: repo.full_name,
                name: repo.name,
                description: repo.description,
                visibility: if repo.private {
                    RepoVisibility::Private
                } else {
                    RepoVisibility::Public
                },
                default_branch: repo.default_branch.unwrap_or_else(|| "main".into()),
                clone_url,
                already_exists: false,
                existing_path: None,
            });
        }

        if page_len < 100 {
            break;
        }
        page += 1;
        if page > 50 {
            break;
        }
    }

    repos.sort_by(|a, b| a.full_name.cmp(&b.full_name));
    Ok(repos)
}

async fn list_github_org_repos(
    client: &reqwest::Client,
    token: &str,
    api: &str,
    base_url: &str,
    org: &str,
) -> anyhow::Result<Vec<RemoteRepo>> {
    let mut repos = Vec::new();
    let mut page = 1u32;
    let url = format!("{api}/orgs/{org}/repos");

    loop {
        let response = github_get(client, &url, token)
            .query(&[("per_page", "100"), ("page", &page.to_string())])
            .send()
            .await
            .context("github org repos request failed")?;

        if !response.status().is_success() {
            return Err(github_auth_error(response).await);
        }

        let page_repos: Vec<GithubRepo> = response.json().await.context("parse github repos")?;
        if page_repos.is_empty() {
            break;
        }

        let page_len = page_repos.len();
        for repo in page_repos {
            let clone_url = repo
                .clone_url
                .or(repo.git_url)
                .unwrap_or_else(|| format!("{base_url}/{}/{}.git", repo.owner.login, repo.name));
            repos.push(RemoteRepo {
                id: repo.id.to_string(),
                full_name: repo.full_name,
                name: repo.name,
                description: repo.description,
                visibility: if repo.private {
                    RepoVisibility::Private
                } else {
                    RepoVisibility::Public
                },
                default_branch: repo.default_branch.unwrap_or_else(|| "main".into()),
                clone_url,
                already_exists: false,
                existing_path: None,
            });
        }

        if page_len < 100 {
            break;
        }
        page += 1;
        if page > 50 {
            break;
        }
    }

    repos.sort_by(|a, b| a.full_name.cmp(&b.full_name));
    Ok(repos)
}

async fn list_github_personal_repos(
    client: &reqwest::Client,
    token: &str,
    api: &str,
    base_url: &str,
    username: &str,
) -> anyhow::Result<Vec<RemoteRepo>> {
    let mut repos = Vec::new();
    let mut page = 1u32;

    loop {
        let response = github_get(client, &format!("{api}/user/repos"), token)
            .query(&[
                ("per_page", "100"),
                ("page", &page.to_string()),
                ("affiliation", "owner"),
            ])
            .send()
            .await
            .context("github personal repos request failed")?;

        if !response.status().is_success() {
            return Err(github_auth_error(response).await);
        }

        let page_repos: Vec<GithubRepo> = response.json().await.context("parse github repos")?;
        if page_repos.is_empty() {
            break;
        }

        let page_len = page_repos.len();
        for repo in page_repos {
            if repo.owner.login != username {
                continue;
            }
            let clone_url = repo
                .clone_url
                .or(repo.git_url)
                .unwrap_or_else(|| format!("{base_url}/{}/{}.git", repo.owner.login, repo.name));
            repos.push(RemoteRepo {
                id: repo.id.to_string(),
                full_name: repo.full_name,
                name: repo.name,
                description: repo.description,
                visibility: if repo.private {
                    RepoVisibility::Private
                } else {
                    RepoVisibility::Public
                },
                default_branch: repo.default_branch.unwrap_or_else(|| "main".into()),
                clone_url,
                already_exists: false,
                existing_path: None,
            });
        }

        if page_len < 100 {
            break;
        }
        page += 1;
        if page > 50 {
            break;
        }
    }

    Ok(repos)
}

async fn list_gitlab_repos(
    token: &str,
    base_url: &str,
    namespace: Option<NamespaceFilter<'_>>,
) -> anyhow::Result<Vec<RemoteRepo>> {
    let client = http_client()?;
    let api = api_base(ImportProvider::Gitlab, base_url);

    if let Some(ns) = namespace {
        if ns.kind == "personal" {
            return list_gitlab_personal_projects(&client, token, &api, ns.path).await;
        }
        return list_gitlab_group_projects(&client, token, &api, ns.path).await;
    }

    let mut repos = Vec::new();
    let mut page = 1u32;

    loop {
        let response = client
            .get(format!("{api}/projects"))
            .query(&[
                ("membership", "true"),
                ("simple", "true"),
                ("per_page", "100"),
                ("page", &page.to_string()),
            ])
            .header("PRIVATE-TOKEN", token)
            .send()
            .await
            .context("gitlab projects request failed")?;

        if !response.status().is_success() {
            anyhow::bail!("failed to list GitLab projects");
        }

        let page_repos: Vec<GitlabProject> = response.json().await.context("parse gitlab projects")?;
        if page_repos.is_empty() {
            break;
        }

        let page_len = page_repos.len();
        for project in page_repos {
            repos.push(RemoteRepo {
                id: project.id.to_string(),
                full_name: project.path_with_namespace,
                name: project.name,
                description: project.description,
                visibility: match project.visibility.as_deref() {
                    Some("public") => RepoVisibility::Public,
                    _ => RepoVisibility::Private,
                },
                default_branch: project.default_branch.unwrap_or_else(|| "main".into()),
                clone_url: project.http_url_to_repo,
                already_exists: false,
                existing_path: None,
            });
        }

        if page_len < 100 {
            break;
        }
        page += 1;
        if page > 50 {
            break;
        }
    }

    repos.sort_by(|a, b| a.full_name.cmp(&b.full_name));
    Ok(repos)
}

async fn list_gitlab_group_projects(
    client: &reqwest::Client,
    token: &str,
    api: &str,
    group_path: &str,
) -> anyhow::Result<Vec<RemoteRepo>> {
    let mut repos = Vec::new();
    let mut page = 1u32;
    let url = format!("{api}/groups/{}/projects", urlencoding::encode(group_path));

    loop {
        let response = client
            .get(&url)
            .query(&[
                ("include_subgroups", "true"),
                ("simple", "true"),
                ("per_page", "100"),
                ("page", &page.to_string()),
            ])
            .header("PRIVATE-TOKEN", token)
            .send()
            .await
            .context("gitlab group projects request failed")?;

        if !response.status().is_success() {
            anyhow::bail!("failed to list GitLab group projects");
        }

        let page_repos: Vec<GitlabProject> = response.json().await.context("parse gitlab projects")?;
        if page_repos.is_empty() {
            break;
        }

        let page_len = page_repos.len();
        for project in page_repos {
            repos.push(RemoteRepo {
                id: project.id.to_string(),
                full_name: project.path_with_namespace,
                name: project.name,
                description: project.description,
                visibility: match project.visibility.as_deref() {
                    Some("public") => RepoVisibility::Public,
                    _ => RepoVisibility::Private,
                },
                default_branch: project.default_branch.unwrap_or_else(|| "main".into()),
                clone_url: project.http_url_to_repo,
                already_exists: false,
                existing_path: None,
            });
        }

        if page_len < 100 {
            break;
        }
        page += 1;
        if page > 50 {
            break;
        }
    }

    repos.sort_by(|a, b| a.full_name.cmp(&b.full_name));
    Ok(repos)
}

async fn list_gitlab_personal_projects(
    client: &reqwest::Client,
    token: &str,
    api: &str,
    username: &str,
) -> anyhow::Result<Vec<RemoteRepo>> {
    let mut repos = Vec::new();
    let mut page = 1u32;

    loop {
        let response = client
            .get(format!("{api}/projects"))
            .query(&[
                ("owned", "true"),
                ("simple", "true"),
                ("per_page", "100"),
                ("page", &page.to_string()),
            ])
            .header("PRIVATE-TOKEN", token)
            .send()
            .await
            .context("gitlab personal projects request failed")?;

        if !response.status().is_success() {
            anyhow::bail!("failed to list GitLab personal projects");
        }

        let page_repos: Vec<GitlabProject> = response.json().await.context("parse gitlab projects")?;
        if page_repos.is_empty() {
            break;
        }

        let page_len = page_repos.len();
        for project in page_repos {
            if !is_gitlab_personal_project(&project.path_with_namespace, username) {
                continue;
            }
            repos.push(RemoteRepo {
                id: project.id.to_string(),
                full_name: project.path_with_namespace,
                name: project.name,
                description: project.description,
                visibility: match project.visibility.as_deref() {
                    Some("public") => RepoVisibility::Public,
                    _ => RepoVisibility::Private,
                },
                default_branch: project.default_branch.unwrap_or_else(|| "main".into()),
                clone_url: project.http_url_to_repo,
                already_exists: false,
                existing_path: None,
            });
        }

        if page_len < 100 {
            break;
        }
        page += 1;
        if page > 50 {
            break;
        }
    }

    Ok(repos)
}

fn is_gitlab_personal_project(path_with_namespace: &str, username: &str) -> bool {
    let prefix = format!("{username}/");
    if !path_with_namespace.starts_with(&prefix) {
        return false;
    }
    !path_with_namespace[prefix.len()..].contains('/')
}

fn http_client() -> anyhow::Result<reqwest::Client> {
    reqwest::Client::builder()
        .user_agent("pertisk-gits-import")
        .build()
        .context("build http client")
}

fn github_get<'a>(
    client: &'a reqwest::Client,
    url: &str,
    token: &str,
) -> reqwest::RequestBuilder {
    client
        .get(url)
        .header("Authorization", format!("Bearer {token}"))
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
}

async fn github_auth_error(response: reqwest::Response) -> anyhow::Error {
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    let message = serde_json::from_str::<GithubError>(&body)
        .ok()
        .map(|err| err.message)
        .filter(|msg| !msg.is_empty())
        .unwrap_or_else(|| body.chars().take(200).collect());

    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        anyhow::anyhow!(
            "GitHub rejected the token ({status}): {message}. Use a classic PAT with the repo scope, or a fine-grained PAT with read access to the repositories you want to import."
        )
    } else {
        anyhow::anyhow!("GitHub API error ({status}): {message}")
    }
}

#[derive(Debug, Deserialize)]
struct GithubOrg {
    id: i64,
    login: String,
}

#[derive(Debug, Deserialize)]
struct GithubError {
    message: String,
}

#[derive(Debug, Deserialize)]
struct GithubUser {
    login: String,
}

#[derive(Debug, Deserialize)]
struct GithubRepo {
    id: i64,
    name: String,
    full_name: String,
    description: Option<String>,
    private: bool,
    default_branch: Option<String>,
    clone_url: Option<String>,
    git_url: Option<String>,
    owner: GithubOwner,
}

#[derive(Debug, Deserialize)]
struct GithubOwner {
    login: String,
}

#[derive(Debug, Deserialize)]
struct GitlabUser {
    username: String,
}

#[derive(Debug, Deserialize)]
struct GitlabGroup {
    id: i64,
    name: String,
    full_path: String,
}

#[derive(Debug, Deserialize)]
struct GitlabProject {
    id: i64,
    name: String,
    path_with_namespace: String,
    description: Option<String>,
    visibility: Option<String>,
    default_branch: Option<String>,
    http_url_to_repo: String,
}
