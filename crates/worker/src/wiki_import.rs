use std::path::Path;

use anyhow::Context;
use pertisk_domain::models::ImportProvider;
use serde::Deserialize;
use sqlx::PgPool;
use tokio::process::Command;
use uuid::Uuid;

pub async fn import_repo_wiki(
    pool: &PgPool,
    provider: ImportProvider,
    token: &str,
    base_url: &str,
    source_full_name: &str,
    source_clone_url: &str,
    repository_id: Uuid,
    author_id: Uuid,
) -> anyhow::Result<u32> {
    match provider {
        ImportProvider::Github => {
            import_github_wiki(pool, token, source_clone_url, repository_id, author_id).await
        }
        ImportProvider::Gitlab => {
            import_gitlab_wiki(
                pool,
                token,
                base_url,
                source_full_name,
                repository_id,
                author_id,
            )
            .await
        }
    }
}

async fn import_github_wiki(
    pool: &PgPool,
    token: &str,
    source_clone_url: &str,
    repository_id: Uuid,
    author_id: Uuid,
) -> anyhow::Result<u32> {
    let wiki_url = github_wiki_clone_url(source_clone_url);
    let auth_url = authenticated_clone_url(ImportProvider::Github, &wiki_url, token)?;
    let tmp = tempfile::TempDir::new().context("create wiki temp dir")?;
    let clone_path = tmp.path();

    let clone = Command::new("git")
        .args([
            "clone",
            "--depth",
            "1",
            "--single-branch",
            &auth_url,
            &clone_path.to_string_lossy(),
        ])
        .output()
        .await
        .context("spawn git clone wiki")?;

    if !clone.status.success() {
        let stderr = String::from_utf8_lossy(&clone.stderr);
        if stderr.contains("not found") || stderr.contains("Repository not found") {
            return Ok(0);
        }
        anyhow::bail!("wiki clone failed: {stderr}");
    }

    let mut pages = 0u32;
    let mut position = 0i32;
    let mut files: Vec<_> = walkdir_markdown_files(clone_path)?;
    files.sort();

    for path in files {
        let file_name = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default();
        if file_name.starts_with('.') {
            continue;
        }
        let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        let body = tokio::fs::read_to_string(&path).await?;
        let slug = slugify_wiki_name(stem);
        if slug.is_empty() {
            continue;
        }
        let title = wiki_title_from_stem(stem);
        upsert_wiki_page(
            pool,
            repository_id,
            author_id,
            &slug,
            &title,
            &body,
            position,
        )
        .await?;
        position += 1;
        pages += 1;
    }

    Ok(pages)
}

fn walkdir_markdown_files(root: &Path) -> anyhow::Result<Vec<std::path::PathBuf>> {
    let mut files = Vec::new();
    for entry in std::fs::read_dir(root)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            if path.file_name().and_then(|n| n.to_str()) == Some(".git") {
                continue;
            }
            files.extend(walkdir_markdown_files(&path)?);
            continue;
        }
        if path
            .extension()
            .and_then(|ext| ext.to_str())
            .is_some_and(|ext| matches!(ext.to_ascii_lowercase().as_str(), "md" | "markdown"))
        {
            files.push(path);
        }
    }
    Ok(files)
}

async fn import_gitlab_wiki(
    pool: &PgPool,
    token: &str,
    base_url: &str,
    source_full_name: &str,
    repository_id: Uuid,
    author_id: Uuid,
) -> anyhow::Result<u32> {
    let api = gitlab_api_base(base_url);
    let project = urlencoding::encode(source_full_name);
    let client = http_client()?;
    let list_url = format!("{api}/projects/{project}/wikis");

    let summaries: Vec<GitlabWikiSummary> =
        paginate_gitlab(&client, token, &list_url, 100).await?;

    let mut pages = 0u32;
    for (position, summary) in summaries.into_iter().enumerate() {
        let page_url = format!("{list_url}/{}", urlencoding::encode(&summary.slug));
        let response = client
            .get(&page_url)
            .header("PRIVATE-TOKEN", token)
            .send()
            .await
            .with_context(|| format!("gitlab GET {page_url}"))?;
        if !response.status().is_success() {
            anyhow::bail!(
                "gitlab wiki page {}: {}",
                response.status(),
                response.text().await.unwrap_or_default()
            );
        }
        let page: GitlabWikiPage = response.json().await?;
        let slug = slugify_wiki_name(&page.slug);
        if slug.is_empty() {
            continue;
        }
        let title = if page.title.trim().is_empty() {
            wiki_title_from_stem(&page.slug)
        } else {
            page.title
        };
        upsert_wiki_page(
            pool,
            repository_id,
            author_id,
            &slug,
            &title,
            &page.content,
            position as i32,
        )
        .await?;
        pages += 1;
    }

    Ok(pages)
}

async fn upsert_wiki_page(
    pool: &PgPool,
    repository_id: Uuid,
    author_id: Uuid,
    slug: &str,
    title: &str,
    body: &str,
    position: i32,
) -> anyhow::Result<()> {
    let page_id = sqlx::query_scalar::<_, Uuid>(
        r#"
        INSERT INTO wiki_pages (
            repository_id, slug, title, body, author_id, parent_slug, position
        )
        VALUES ($1, $2, $3, $4, $5, NULL, $6)
        ON CONFLICT (repository_id, slug) DO UPDATE SET
            title = EXCLUDED.title,
            body = EXCLUDED.body,
            position = EXCLUDED.position,
            updated_at = NOW()
        RETURNING id
        "#,
    )
    .bind(repository_id)
    .bind(slug)
    .bind(title)
    .bind(body)
    .bind(author_id)
    .bind(position)
    .fetch_one(pool)
    .await?;

    sqlx::query(
        r#"
        INSERT INTO wiki_page_revisions (page_id, author_id, title, body)
        VALUES ($1, $2, $3, $4)
        "#,
    )
    .bind(page_id)
    .bind(author_id)
    .bind(title)
    .bind(body)
    .execute(pool)
    .await?;

    Ok(())
}

fn github_wiki_clone_url(clone_url: &str) -> String {
    let trimmed = clone_url.trim_end_matches('/');
    let without_git = trimmed.strip_suffix(".git").unwrap_or(trimmed);
    format!("{without_git}.wiki.git")
}

fn slugify_wiki_name(name: &str) -> String {
    let mut slug = String::new();
    let mut last_dash = false;

    for ch in name.trim().to_lowercase().chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch);
            last_dash = false;
        } else if !last_dash && !slug.is_empty() {
            slug.push('-');
            last_dash = true;
        }
    }

    slug.trim_matches('-').to_string()
}

fn wiki_title_from_stem(stem: &str) -> String {
    stem.split(|ch| ch == '-' || ch == '_')
        .filter(|part| !part.is_empty())
        .map(|part| {
            let mut chars = part.chars();
            match chars.next() {
                None => String::new(),
                Some(first) => {
                    let mut word = first.to_uppercase().collect::<String>();
                    word.push_str(&chars.as_str().to_lowercase());
                    word
                }
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn authenticated_clone_url(
    provider: ImportProvider,
    clone_url: &str,
    token: &str,
) -> anyhow::Result<String> {
    let scheme_end = clone_url
        .find("://")
        .map(|index| index + 3)
        .ok_or_else(|| anyhow::anyhow!("invalid clone URL"))?;
    let (scheme, rest) = clone_url.split_at(scheme_end);
    if rest.contains('@') {
        anyhow::bail!("clone URL already contains credentials");
    }
    let username = match provider {
        ImportProvider::Github => "x-access-token",
        ImportProvider::Gitlab => "oauth2",
    };
    Ok(format!("{scheme}{username}:{token}@{rest}"))
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
            if response.status().as_u16() == 404 {
                return Ok(Vec::new());
            }
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

#[derive(Debug, Deserialize)]
struct GitlabWikiSummary {
    slug: String,
}

#[derive(Debug, Deserialize)]
struct GitlabWikiPage {
    slug: String,
    title: String,
    content: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn github_wiki_clone_url_appends_wiki_suffix() {
        assert_eq!(
            github_wiki_clone_url("https://github.com/acme/widget.git"),
            "https://github.com/acme/widget.wiki.git"
        );
        assert_eq!(
            github_wiki_clone_url("https://github.com/acme/widget"),
            "https://github.com/acme/widget.wiki.git"
        );
    }

    #[test]
    fn slugify_wiki_name_normalizes() {
        assert_eq!(slugify_wiki_name("Home"), "home");
        assert_eq!(slugify_wiki_name("Some-Page_Name"), "some-page-name");
    }

    #[test]
    fn wiki_title_from_stem_formats_words() {
        assert_eq!(wiki_title_from_stem("Home"), "Home");
        assert_eq!(wiki_title_from_stem("some-page_name"), "Some Page Name");
    }
}
