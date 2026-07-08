use pertisk_domain::models::RepoVisibility;
use pertisk_git::access::{self, AuthUser, RepoRecord};
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct ContainerRepo {
    pub id: Uuid,
    pub org_path: String,
    pub project_slug: String,
    pub image_name: String,
    pub provider: String,
}

async fn find_repo_record(
    pool: &PgPool,
    org_path: &str,
    project_slug: &str,
) -> anyhow::Result<Option<RepoRecord>> {
    let row = sqlx::query_as::<_, (Uuid, Uuid, RepoVisibility)>(
        r#"
        SELECT r.id, o.id, r.visibility
        FROM repositories r
        INNER JOIN organizations o ON o.id = r.organization_id
        WHERE o.full_path = $1 AND r.slug = $2
        "#,
    )
    .bind(org_path)
    .bind(project_slug)
    .fetch_optional(pool)
    .await?;

    Ok(row.map(|(id, org_id, visibility)| RepoRecord {
        id,
        org_id,
        org_path: org_path.to_string(),
        repo_slug: project_slug.to_string(),
        visibility,
    }))
}

pub async fn is_org_member(pool: &PgPool, org_path: &str, user_id: Uuid) -> anyhow::Result<bool> {
    let ok = sqlx::query_scalar::<_, bool>(
        r#"
        SELECT EXISTS(
            SELECT 1 FROM organization_members m
            INNER JOIN organizations o ON o.id = m.organization_id
            WHERE o.full_path = $1 AND m.user_id = $2
        )
        "#,
    )
    .bind(org_path)
    .bind(user_id)
    .fetch_one(pool)
    .await?;
    Ok(ok)
}

pub async fn can_push(
    pool: &PgPool,
    org_path: &str,
    project_slug: &str,
    user_id: Uuid,
) -> anyhow::Result<bool> {
    if is_super_admin_user(pool, user_id).await? {
        return Ok(true);
    }

    let Some(repo) = find_repo_record(pool, org_path, project_slug).await? else {
        return Ok(false);
    };

    access::can_write_repo(
        pool,
        &repo,
        &AuthUser {
            id: user_id,
            username: String::new(),
        },
    )
    .await
}

pub async fn can_pull(
    pool: &PgPool,
    org_path: &str,
    project_slug: &str,
    user_id: Uuid,
) -> anyhow::Result<bool> {
    if is_super_admin_user(pool, user_id).await? {
        return Ok(true);
    }

    let Some(repo) = find_repo_record(pool, org_path, project_slug).await? else {
        return Ok(false);
    };

    access::can_read_repo(
        pool,
        &repo,
        Some(&AuthUser {
            id: user_id,
            username: String::new(),
        }),
    )
    .await
}

pub async fn is_public_container_image(pool: &PgPool, repo_name: &str) -> anyhow::Result<bool> {
    let Some(parsed) = parse_image_name(repo_name) else {
        return Ok(false);
    };

    let public = sqlx::query_scalar::<_, bool>(
        r#"
        SELECT EXISTS(
            SELECT 1
            FROM repositories r
            INNER JOIN organizations o ON o.id = r.organization_id
            INNER JOIN container_repositories cr ON cr.repository_id = r.id
            WHERE o.full_path = $1
              AND r.slug = $2
              AND COALESCE(cr.provider, 'pertisk') = $3
                            AND cr.name = $4
              AND r.visibility = 'public'
        )
        "#,
    )
    .bind(parsed.org_path)
    .bind(parsed.project_slug)
    .bind(parsed.provider)
        .bind(parsed.image_name)
    .fetch_one(pool)
    .await?;

    Ok(public)
}

pub async fn is_super_admin_user(pool: &PgPool, user_id: Uuid) -> anyhow::Result<bool> {
    if let Ok(ids) = std::env::var("SUPER_ADMIN_USER_IDS") {
        let allowed: Vec<Uuid> = ids
            .split(',')
            .filter_map(|value| Uuid::parse_str(value.trim()).ok())
            .collect();
        if allowed.contains(&user_id) {
            return Ok(true);
        }
    }

    let ok = sqlx::query_scalar::<_, bool>(
        r#"
        SELECT EXISTS(
            SELECT 1
            FROM users
            WHERE id = $1
              AND is_super_admin = TRUE
        )
        "#,
    )
    .bind(user_id)
    .fetch_one(pool)
    .await?;

    Ok(ok)
}

pub async fn get_or_create_repository(
    pool: &PgPool,
    org_path: &str,
    project_slug: &str,
    image_name: &str,
    provider: &str,
) -> anyhow::Result<ContainerRepo> {
    if let Some(repo) = find_repository(pool, org_path, project_slug, image_name, provider).await? {
        return Ok(repo);
    }

    let row = sqlx::query_as::<_, (Uuid,)>(
        r#"
        INSERT INTO container_repositories (organization_id, repository_id, name, provider)
        SELECT o.id, r.id, $3, $4
        FROM repositories r
        INNER JOIN organizations o ON o.id = r.organization_id
        WHERE o.full_path = $1 AND r.slug = $2
        ON CONFLICT DO NOTHING
        RETURNING id
        "#,
    )
    .bind(org_path)
    .bind(project_slug)
    .bind(image_name)
    .bind(provider)
    .fetch_optional(pool)
    .await?;

    let id = if let Some((id,)) = row {
        id
    } else if let Some(repo) = find_repository(pool, org_path, project_slug, image_name, provider).await? {
        repo.id
    } else {
        anyhow::bail!("project not found: {org_path}/{project_slug}");
    };

    Ok(ContainerRepo {
        id,
        org_path: org_path.to_string(),
        project_slug: project_slug.to_string(),
        image_name: image_name.to_string(),
        provider: provider.to_string(),
    })
}

pub async fn find_repository(
    pool: &PgPool,
    org_path: &str,
    project_slug: &str,
    image_name: &str,
    provider: &str,
) -> anyhow::Result<Option<ContainerRepo>> {
    let row = sqlx::query_as::<_, (Uuid,)>(
        r#"
        SELECT cr.id
        FROM container_repositories cr
        INNER JOIN repositories r ON r.id = cr.repository_id
        INNER JOIN organizations o ON o.id = r.organization_id
        WHERE o.full_path = $1
          AND r.slug = $2
          AND COALESCE(cr.provider, 'pertisk') = $3
                    AND cr.name = $4
        "#,
    )
    .bind(org_path)
    .bind(project_slug)
    .bind(provider)
        .bind(image_name)
    .fetch_optional(pool)
    .await?;

    Ok(row.map(|(id,)| ContainerRepo {
        id,
        org_path: org_path.to_string(),
        project_slug: project_slug.to_string(),
        image_name: image_name.to_string(),
        provider: provider.to_string(),
    }))
}

#[derive(Debug, Clone)]
pub struct ParsedImageName {
    pub provider: String,
    pub org_path: String,
    pub project_slug: String,
    pub image_name: String,
}

pub fn parse_image_name(full_name: &str) -> Option<ParsedImageName> {
    let parts: Vec<&str> = full_name.split('/').filter(|s| !s.is_empty()).collect();
    if parts.len() < 2 {
        return None;
    }

    if parts.len() == 2 {
        return Some(ParsedImageName {
            provider: "pertisk".to_string(),
            org_path: parts[0].to_string(),
            project_slug: parts[1].to_string(),
            image_name: parts[1].to_string(),
        });
    }

    if parts.len() == 3 {
        return Some(ParsedImageName {
            provider: "pertisk".to_string(),
            org_path: parts[0].to_string(),
            project_slug: parts[1].to_string(),
            image_name: parts[2].to_string(),
        });
    }

    let provider = parts[0].to_string();
    let org_path = parts[1..parts.len() - 2].join("/");
    let project_slug = parts[parts.len() - 2].to_string();
    let image_name = parts[parts.len() - 1].to_string();
    if org_path.is_empty() {
        return None;
    }

    Some(ParsedImageName {
        provider,
        org_path,
        project_slug,
        image_name,
    })
}

fn format_catalog_repo_name(provider: &str, org_path: &str, project_slug: &str, image_name: &str) -> String {
    if provider == "pertisk" {
        format!("{org_path}/{project_slug}/{image_name}")
    } else {
        format!("{provider}/{org_path}/{project_slug}/{image_name}")
    }
}

const DEFAULT_CATALOG_PAGE: u32 = 100;
const MAX_CATALOG_PAGE: u32 = 1000;

pub fn normalize_catalog_page_size(n: Option<u32>) -> u32 {
    n.unwrap_or(DEFAULT_CATALOG_PAGE).clamp(1, MAX_CATALOG_PAGE)
}

pub async fn list_catalog_repositories(
    pool: &PgPool,
    user_id: Uuid,
    last: Option<&str>,
    limit: u32,
) -> anyhow::Result<Vec<String>> {
    let rows = sqlx::query_as::<_, (String, String, String, String)>(
        r#"
        SELECT COALESCE(cr.provider, 'pertisk') AS provider, o.full_path, r.slug, cr.name
        FROM container_repositories cr
        INNER JOIN repositories r ON r.id = cr.repository_id
        INNER JOIN organizations o ON o.id = r.organization_id
        INNER JOIN organization_members m ON m.organization_id = o.id AND m.user_id = $1
        ORDER BY COALESCE(cr.provider, 'pertisk') ASC, o.full_path ASC, r.slug ASC, cr.name ASC
        "#,
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;

    let mut names: Vec<String> = rows
        .into_iter()
        .map(|(provider, org_path, project_slug, image_name)| {
            format_catalog_repo_name(&provider, &org_path, &project_slug, &image_name)
        })
        .collect();

    if let Some(last_name) = last {
        names.retain(|name| name.as_str() > last_name);
    }
    names.truncate(limit as usize);

    Ok(names)
}

pub async fn list_org_catalog_repositories(
    pool: &PgPool,
    org_path: &str,
    user_id: Uuid,
    provider: &str,
    last: Option<&str>,
    limit: u32,
) -> anyhow::Result<Vec<String>> {
    let rows = sqlx::query_scalar::<_, String>(
        r#"
                SELECT r.slug || '/' || cr.name
        FROM container_repositories cr
        INNER JOIN repositories r ON r.id = cr.repository_id
        INNER JOIN organizations o ON o.id = r.organization_id
        INNER JOIN organization_members m ON m.organization_id = o.id AND m.user_id = $2
        WHERE o.full_path = $1
          AND COALESCE(cr.provider, 'pertisk') = $3
                    AND ($4::text IS NULL OR (r.slug || '/' || cr.name) > $4)
                ORDER BY r.slug ASC, cr.name ASC
        LIMIT $5
        "#,
    )
    .bind(org_path)
    .bind(user_id)
    .bind(provider)
    .bind(last)
    .bind(limit as i64)
    .fetch_all(pool)
    .await?;

    Ok(rows)
}

pub async fn user_has_org_membership(pool: &PgPool, user_id: Uuid) -> anyhow::Result<bool> {
    let ok = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM organization_members WHERE user_id = $1)",
    )
    .bind(user_id)
    .fetch_one(pool)
    .await?;
    Ok(ok)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_image_name_valid() {
        let parsed = parse_image_name("acme/widget").unwrap();
        assert_eq!(parsed.provider, "pertisk");
        assert_eq!(parsed.org_path, "acme");
        assert_eq!(parsed.project_slug, "widget");
        assert_eq!(parsed.image_name, "widget");

        let parsed = parse_image_name("acme/widget/travela").unwrap();
        assert_eq!(parsed.provider, "pertisk");
        assert_eq!(parsed.org_path, "acme");
        assert_eq!(parsed.project_slug, "widget");
        assert_eq!(parsed.image_name, "travela");

        let parsed = parse_image_name("dockerhub/hackintosh/kreactnative/travela").unwrap();
        assert_eq!(parsed.provider, "dockerhub");
        assert_eq!(parsed.org_path, "hackintosh");
        assert_eq!(parsed.project_slug, "kreactnative");
        assert_eq!(parsed.image_name, "travela");
    }

    #[test]
    fn parse_image_name_rejects_invalid() {
        assert!(parse_image_name("").is_none());
        assert!(parse_image_name("noseparator").is_none());
        assert!(parse_image_name("/image").is_none());
        assert!(parse_image_name("org/").is_none());
    }

    #[test]
    fn normalize_catalog_page_size_clamps() {
        assert_eq!(normalize_catalog_page_size(None), 100);
        assert_eq!(normalize_catalog_page_size(Some(0)), 1);
        assert_eq!(normalize_catalog_page_size(Some(5000)), 1000);
        assert_eq!(normalize_catalog_page_size(Some(50)), 50);
    }
}
