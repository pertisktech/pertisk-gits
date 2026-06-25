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
