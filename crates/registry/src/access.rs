use pertisk_domain::models::OrgRole;
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct ContainerRepo {
    pub id: Uuid,
    pub org_slug: String,
    pub name: String,
}

pub async fn find_org_id(pool: &PgPool, org_slug: &str) -> anyhow::Result<Option<Uuid>> {
    let id = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM organizations WHERE slug = $1",
    )
    .bind(org_slug)
    .fetch_optional(pool)
    .await?;
    Ok(id)
}

pub async fn is_org_member(pool: &PgPool, org_slug: &str, user_id: Uuid) -> anyhow::Result<bool> {
    let ok = sqlx::query_scalar::<_, bool>(
        r#"
        SELECT EXISTS(
            SELECT 1 FROM organization_members m
            INNER JOIN organizations o ON o.id = m.organization_id
            WHERE o.slug = $1 AND m.user_id = $2
        )
        "#,
    )
    .bind(org_slug)
    .bind(user_id)
    .fetch_one(pool)
    .await?;
    Ok(ok)
}

pub async fn can_push(pool: &PgPool, org_slug: &str, user_id: Uuid) -> anyhow::Result<bool> {
    let role = sqlx::query_scalar::<_, OrgRole>(
        r#"
        SELECT m.role
        FROM organization_members m
        INNER JOIN organizations o ON o.id = m.organization_id
        WHERE o.slug = $1 AND m.user_id = $2
        "#,
    )
    .bind(org_slug)
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    Ok(matches!(
        role,
        Some(OrgRole::Owner) | Some(OrgRole::Admin) | Some(OrgRole::Member)
    ))
}

pub async fn can_pull(pool: &PgPool, org_slug: &str, user_id: Uuid) -> anyhow::Result<bool> {
    is_org_member(pool, org_slug, user_id).await
}

pub async fn get_or_create_repository(
    pool: &PgPool,
    org_slug: &str,
    image_name: &str,
) -> anyhow::Result<ContainerRepo> {
    if let Some(repo) = find_repository(pool, org_slug, image_name).await? {
        return Ok(repo);
    }

    let org_id = find_org_id(pool, org_slug)
        .await?
        .ok_or_else(|| anyhow::anyhow!("organization not found: {org_slug}"))?;

    let id = sqlx::query_scalar::<_, Uuid>(
        r#"
        INSERT INTO container_repositories (organization_id, name)
        VALUES ($1, $2)
        ON CONFLICT (organization_id, name) DO UPDATE SET updated_at = NOW()
        RETURNING id
        "#,
    )
    .bind(org_id)
    .bind(image_name)
    .fetch_one(pool)
    .await?;

    Ok(ContainerRepo {
        id,
        org_slug: org_slug.to_string(),
        name: image_name.to_string(),
    })
}

pub async fn find_repository(
    pool: &PgPool,
    org_slug: &str,
    image_name: &str,
) -> anyhow::Result<Option<ContainerRepo>> {
    let row = sqlx::query_as::<_, (Uuid,)>(
        r#"
        SELECT r.id
        FROM container_repositories r
        INNER JOIN organizations o ON o.id = r.organization_id
        WHERE o.slug = $1 AND r.name = $2
        "#,
    )
    .bind(org_slug)
    .bind(image_name)
    .fetch_optional(pool)
    .await?;

    Ok(row.map(|(id,)| ContainerRepo {
        id,
        org_slug: org_slug.to_string(),
        name: image_name.to_string(),
    }))
}

pub fn parse_image_name(full_name: &str) -> Option<(&str, &str)> {
    let (org, image) = full_name.split_once('/')?;
    if org.is_empty() || image.is_empty() || image.contains('/') {
        return None;
    }
    Some((org, image))
}

const DEFAULT_CATALOG_PAGE: u32 = 100;
const MAX_CATALOG_PAGE: u32 = 1000;

pub fn normalize_catalog_page_size(n: Option<u32>) -> u32 {
    n.unwrap_or(DEFAULT_CATALOG_PAGE)
        .clamp(1, MAX_CATALOG_PAGE)
}

/// Full repository names (`org/image`) visible to the user, paginated lexicographically.
pub async fn list_catalog_repositories(
    pool: &PgPool,
    user_id: Uuid,
    last: Option<&str>,
    limit: u32,
) -> anyhow::Result<Vec<String>> {
    let rows = sqlx::query_scalar::<_, String>(
        r#"
        SELECT o.slug || '/' || cr.name AS full_name
        FROM container_repositories cr
        INNER JOIN organizations o ON o.id = cr.organization_id
        INNER JOIN organization_members m ON m.organization_id = o.id AND m.user_id = $1
        WHERE ($2::text IS NULL OR (o.slug || '/' || cr.name) > $2)
        ORDER BY o.slug || '/' || cr.name ASC
        LIMIT $3
        "#,
    )
    .bind(user_id)
    .bind(last)
    .bind(limit as i64)
    .fetch_all(pool)
    .await?;

    Ok(rows)
}

/// Image names within one organization for `/v2/{org}/_catalog`.
pub async fn list_org_catalog_repositories(
    pool: &PgPool,
    org_slug: &str,
    user_id: Uuid,
    last: Option<&str>,
    limit: u32,
) -> anyhow::Result<Vec<String>> {
    let rows = sqlx::query_scalar::<_, String>(
        r#"
        SELECT cr.name
        FROM container_repositories cr
        INNER JOIN organizations o ON o.id = cr.organization_id
        INNER JOIN organization_members m ON m.organization_id = o.id AND m.user_id = $2
        WHERE o.slug = $1
          AND ($3::text IS NULL OR cr.name > $3)
        ORDER BY cr.name ASC
        LIMIT $4
        "#,
    )
    .bind(org_slug)
    .bind(user_id)
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
