use pertisk_domain::models::{OrgRole, RepoRole, RepoVisibility};
use sqlx::PgPool;
use uuid::Uuid;

use crate::password::verify_password;

#[derive(Debug, Clone)]
pub struct RepoRecord {
    pub id: Uuid,
    pub org_slug: String,
    pub repo_slug: String,
    pub visibility: RepoVisibility,
}

#[derive(Debug, Clone)]
pub struct AuthUser {
    pub id: Uuid,
    pub username: String,
}

pub async fn find_repo(pool: &PgPool, org_slug: &str, repo_slug: &str) -> anyhow::Result<Option<RepoRecord>> {
    let row = sqlx::query_as::<_, (Uuid, RepoVisibility)>(
        r#"
        SELECT r.id, r.visibility
        FROM repositories r
        INNER JOIN organizations o ON o.id = r.organization_id
        WHERE o.slug = $1 AND r.slug = $2
        "#,
    )
    .bind(org_slug)
    .bind(repo_slug)
    .fetch_optional(pool)
    .await?;

    Ok(row.map(|(id, visibility)| RepoRecord {
        id,
        org_slug: org_slug.to_string(),
        repo_slug: repo_slug.to_string(),
        visibility,
    }))
}

pub async fn authenticate_basic(
    pool: &PgPool,
    username: &str,
    password: &str,
) -> anyhow::Result<Option<AuthUser>> {
    let user = sqlx::query_as::<_, (Uuid, String, Option<String>)>(
        r#"
        SELECT id, username, password_hash
        FROM users
        WHERE username = $1 OR email = $1
        "#,
    )
    .bind(username)
    .fetch_optional(pool)
    .await?;

    let Some((id, username, password_hash)) = user else {
        return Ok(None);
    };

    let Some(hash) = password_hash else {
        return Ok(None);
    };

    if !verify_password(password, &hash)? {
        return Ok(None);
    }

    Ok(Some(AuthUser { id, username }))
}

pub async fn can_read_repo(pool: &PgPool, repo: &RepoRecord, user: Option<&AuthUser>) -> anyhow::Result<bool> {
    if repo.visibility == RepoVisibility::Public {
        return Ok(true);
    }

    let Some(user) = user else {
        return Ok(false);
    };

    Ok(has_repo_access(pool, repo, user.id, false).await?)
}

pub async fn can_write_repo(pool: &PgPool, repo: &RepoRecord, user: &AuthUser) -> anyhow::Result<bool> {
    has_repo_access(pool, repo, user.id, true).await
}

async fn has_repo_access(
    pool: &PgPool,
    repo: &RepoRecord,
    user_id: Uuid,
    write_required: bool,
) -> anyhow::Result<bool> {
    let org_member = sqlx::query_scalar::<_, bool>(
        r#"
        SELECT EXISTS(
            SELECT 1 FROM organization_members m
            INNER JOIN organizations o ON o.id = m.organization_id
            WHERE o.slug = $1 AND m.user_id = $2
        )
        "#,
    )
    .bind(&repo.org_slug)
    .bind(user_id)
    .fetch_one(pool)
    .await?;

    if org_member && !write_required {
        return Ok(true);
    }

    let role = sqlx::query_as::<_, (Option<RepoRole>,)>(
        r#"
        SELECT rp.role
        FROM repository_permissions rp
        WHERE rp.repository_id = $1 AND rp.user_id = $2
        "#,
    )
    .bind(repo.id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    if let Some((Some(role),)) = role {
        return Ok(match role {
            RepoRole::Read => !write_required,
            RepoRole::Write | RepoRole::Admin => true,
        });
    }

    if org_member && write_required {
        let org_role = sqlx::query_scalar::<_, OrgRole>(
            r#"
            SELECT m.role
            FROM organization_members m
            INNER JOIN organizations o ON o.id = m.organization_id
            WHERE o.slug = $1 AND m.user_id = $2
            "#,
        )
        .bind(&repo.org_slug)
        .bind(user_id)
        .fetch_optional(pool)
        .await?;

        return Ok(matches!(org_role, Some(OrgRole::Owner) | Some(OrgRole::Admin)));
    }

    Ok(false)
}

pub fn parse_basic_auth(header: &str) -> Option<(String, String)> {
    let encoded = header.strip_prefix("Basic ")?;
    let decoded = base64_decode(encoded).ok()?;
    let (user, pass) = decoded.split_once(':')?;
    Some((user.to_string(), pass.to_string()))
}

fn base64_decode(input: &str) -> Result<String, ()> {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let input = input.trim_end_matches('=');
    let mut bits = 0u32;
    let mut bit_count = 0;
    let mut out = Vec::new();

    for ch in input.bytes() {
        let val = TABLE.iter().position(|&t| t == ch).ok_or(())? as u32;
        bits = (bits << 6) | val;
        bit_count += 6;
        if bit_count >= 8 {
            bit_count -= 8;
            out.push((bits >> bit_count) as u8);
            bits &= (1 << bit_count) - 1;
        }
    }

    String::from_utf8(out).map_err(|_| ())
}
