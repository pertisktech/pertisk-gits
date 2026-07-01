use pertisk_domain::{
    models::{OrgRole, RepoRole, RepoVisibility},
    permissions::{max_repo_role, repo_role_allows_read, repo_role_allows_write, CustomRolePermissions},
};
use sqlx::PgPool;
use uuid::Uuid;

use crate::password::verify_password;

#[derive(Debug, Clone)]
pub struct RepoRecord {
    pub id: Uuid,
    pub org_id: Uuid,
    pub org_path: String,
    pub repo_slug: String,
    pub visibility: RepoVisibility,
}

#[derive(Debug, Clone)]
pub struct AuthUser {
    pub id: Uuid,
    pub username: String,
}

#[derive(Debug, Clone)]
pub enum GitPrincipal {
    User(AuthUser),
    /// SSH public key matched a deploy key; access is checked per repository at git command time.
    DeployKey { fingerprint: String },
}

impl GitPrincipal {
    pub fn user(&self) -> Option<&AuthUser> {
        match self {
            GitPrincipal::User(user) => Some(user),
            GitPrincipal::DeployKey { fingerprint: _ } => None,
        }
    }
}

pub async fn find_repo(pool: &PgPool, org_path: &str, repo_slug: &str) -> anyhow::Result<Option<RepoRecord>> {
    let row = sqlx::query_as::<_, (Uuid, Uuid, RepoVisibility)>(
        r#"
        SELECT r.id, o.id, r.visibility
        FROM repositories r
        INNER JOIN organizations o ON o.id = r.organization_id
        WHERE o.full_path = $1 AND r.slug = $2
        "#,
    )
    .bind(org_path)
    .bind(repo_slug)
    .fetch_optional(pool)
    .await?;

    Ok(row.map(|(id, org_id, visibility)| RepoRecord {
        id,
        org_id,
        org_path: org_path.to_string(),
        repo_slug: repo_slug.to_string(),
        visibility,
    }))
}

pub async fn authenticate_basic(
    pool: &PgPool,
    username: &str,
    password: &str,
) -> anyhow::Result<Option<AuthUser>> {
    let user = sqlx::query_as::<_, (Uuid, String, Option<String>, String)>(
        r#"
        SELECT id, username, password_hash, approval_status::text
        FROM users
        WHERE username = $1 OR email = $1
        "#,
    )
    .bind(username)
    .fetch_optional(pool)
    .await?;

    let Some((id, username, password_hash, approval_status)) = user else {
        return Ok(None);
    };

    if approval_status != "approved" {
        return Ok(None);
    }

    let Some(hash) = password_hash else {
        return Ok(None);
    };

    if !verify_password(password, &hash)? {
        return Ok(None);
    }

    Ok(Some(AuthUser { id, username }))
}

pub async fn can_read_repo(pool: &PgPool, repo: &RepoRecord, user: Option<&AuthUser>) -> anyhow::Result<bool> {
    match user {
        Some(user) => can_read_repo_principal(pool, repo, &GitPrincipal::User(user.clone())).await,
        None if repo.visibility == RepoVisibility::Public => Ok(true),
        None => Ok(false),
    }
}

pub async fn can_write_repo(pool: &PgPool, repo: &RepoRecord, user: &AuthUser) -> anyhow::Result<bool> {
    can_write_repo_principal(pool, repo, &GitPrincipal::User(user.clone())).await
}

pub async fn can_read_repo_principal(
    pool: &PgPool,
    repo: &RepoRecord,
    principal: &GitPrincipal,
) -> anyhow::Result<bool> {
    match principal {
        GitPrincipal::DeployKey { fingerprint } => Ok(
            find_deploy_key_for_repo(pool, fingerprint, repo.id)
                .await?
                .is_some(),
        ),
        GitPrincipal::User(user) => {
            if repo.visibility == RepoVisibility::Public {
                return Ok(true);
            }
            has_repo_access(pool, repo, user.id, false).await
        }
    }
}

pub async fn can_write_repo_principal(
    pool: &PgPool,
    repo: &RepoRecord,
    principal: &GitPrincipal,
) -> anyhow::Result<bool> {
    match principal {
        GitPrincipal::DeployKey { fingerprint } => Ok(
            find_deploy_key_for_repo(pool, fingerprint, repo.id)
                .await?
                .is_some_and(|(_, read_only)| !read_only),
        ),
        GitPrincipal::User(user) => has_repo_access(pool, repo, user.id, true).await,
    }
}

async fn find_deploy_key_for_repo(
    pool: &PgPool,
    fingerprint: &str,
    repository_id: Uuid,
) -> anyhow::Result<Option<(Uuid, bool)>> {
    let row = sqlx::query_as::<_, (Uuid, bool)>(
        r#"
        SELECT id, read_only
        FROM repository_deploy_keys
        WHERE fingerprint = $1 AND repository_id = $2
        "#,
    )
    .bind(fingerprint)
    .bind(repository_id)
    .fetch_optional(pool)
    .await?;

    Ok(row)
}

async fn has_repo_access(
    pool: &PgPool,
    repo: &RepoRecord,
    user_id: Uuid,
    write_required: bool,
) -> anyhow::Result<bool> {
    let role = effective_repo_role(pool, repo, user_id).await?;
    match role {
        Some(role) if write_required => Ok(repo_role_allows_write(role)),
        Some(role) => Ok(repo_role_allows_read(role)),
        None => Ok(false),
    }
}

pub async fn effective_repo_role(
    pool: &PgPool,
    repo: &RepoRecord,
    user_id: Uuid,
) -> anyhow::Result<Option<RepoRole>> {
    let mut effective: Option<RepoRole> = None;

    if let Some(direct) = sqlx::query_scalar::<_, RepoRole>(
        r#"
        SELECT role
        FROM repository_permissions
        WHERE repository_id = $1 AND user_id = $2
        "#,
    )
    .bind(repo.id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?
    {
        effective = max_repo_role(effective, Some(direct));
    }

    let team_roles = sqlx::query_scalar::<_, RepoRole>(
        r#"
        SELECT trp.role
        FROM team_repository_permissions trp
        INNER JOIN team_members tm ON tm.team_id = trp.team_id
        INNER JOIN teams t ON t.id = trp.team_id
        INNER JOIN organizations o ON o.id = t.organization_id
        WHERE trp.repository_id = $1 AND tm.user_id = $2 AND o.full_path = $3
        "#,
    )
    .bind(repo.id)
    .bind(user_id)
    .bind(&repo.org_path)
    .fetch_all(pool)
    .await?;

    for team_role in team_roles {
        effective = max_repo_role(effective, Some(team_role));
    }

    let memberships = sqlx::query_as::<_, (OrgRole, Option<sqlx::types::Json<CustomRolePermissions>>)>(
        r#"
        WITH RECURSIVE ancestors AS (
            SELECT id, parent_id FROM organizations WHERE id = $1
            UNION ALL
            SELECT o.id, o.parent_id FROM organizations o
            INNER JOIN ancestors a ON o.id = a.parent_id
        )
        SELECT m.role, cr.permissions
        FROM organization_members m
        LEFT JOIN organization_custom_roles cr ON cr.id = m.custom_role_id
        WHERE m.user_id = $2
          AND m.organization_id IN (SELECT id FROM ancestors)
        "#,
    )
    .bind(repo.org_id)
    .bind(user_id)
    .fetch_all(pool)
    .await?;

    for (org_role, custom_permissions) in memberships {
        let baseline = match org_role {
            OrgRole::Owner | OrgRole::Admin => Some(RepoRole::Write),
            OrgRole::Member => Some(RepoRole::Read),
        };
        effective = max_repo_role(effective, baseline);

        if let Some(custom) = custom_permissions {
            if let Some(default_access) = custom.0.default_repo_access {
                effective = max_repo_role(effective, Some(default_access));
            }
        }
    }

    Ok(effective)
}

pub async fn can_admin_repo(
    pool: &PgPool,
    org_id: Uuid,
    repository_id: Uuid,
    user_id: Uuid,
) -> anyhow::Result<bool> {
    if sqlx::query_scalar::<_, bool>(
        r#"
        SELECT EXISTS(
            SELECT 1 FROM repository_permissions
            WHERE repository_id = $1 AND user_id = $2 AND role = 'admin'
        )
        "#,
    )
    .bind(repository_id)
    .bind(user_id)
    .fetch_one(pool)
    .await?
    {
        return Ok(true);
    }

    if sqlx::query_scalar::<_, bool>(
        r#"
        SELECT EXISTS(
            SELECT 1
            FROM team_repository_permissions trp
            INNER JOIN team_members tm ON tm.team_id = trp.team_id
            WHERE trp.repository_id = $1 AND tm.user_id = $2 AND trp.role = 'admin'
        )
        "#,
    )
    .bind(repository_id)
    .bind(user_id)
    .fetch_one(pool)
    .await?
    {
        return Ok(true);
    }

    let membership = sqlx::query_as::<_, (OrgRole, Option<sqlx::types::Json<CustomRolePermissions>>)>(
        r#"
        SELECT m.role, cr.permissions
        FROM organization_members m
        LEFT JOIN organization_custom_roles cr ON cr.id = m.custom_role_id
        WHERE m.organization_id = $1 AND m.user_id = $2
        "#,
    )
    .bind(org_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    if let Some((org_role, custom_permissions)) = membership {
        if matches!(org_role, OrgRole::Owner | OrgRole::Admin) {
            return Ok(true);
        }
        if let Some(custom) = custom_permissions {
            if custom.0.default_repo_access == Some(RepoRole::Admin) {
                return Ok(true);
            }
        }
    }

    Ok(false)
}

pub async fn org_member_has_permission(
    pool: &PgPool,
    org_id: Uuid,
    user_id: Uuid,
    check: impl FnOnce(&CustomRolePermissions) -> bool,
) -> anyhow::Result<bool> {
    let membership = sqlx::query_as::<_, (OrgRole, Option<sqlx::types::Json<CustomRolePermissions>>)>(
        r#"
        SELECT m.role, cr.permissions
        FROM organization_members m
        LEFT JOIN organization_custom_roles cr ON cr.id = m.custom_role_id
        WHERE m.organization_id = $1 AND m.user_id = $2
        "#,
    )
    .bind(org_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    let Some((org_role, custom_permissions)) = membership else {
        return Ok(false);
    };

    if matches!(org_role, OrgRole::Owner | OrgRole::Admin) {
        return Ok(true);
    }

    Ok(custom_permissions
        .map(|permissions| check(&permissions.0))
        .unwrap_or(false))
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_basic_auth_valid() {
        // user:pass -> dXNlcjpwYXNz
        let (user, pass) = parse_basic_auth("Basic dXNlcjpwYXNz").unwrap();
        assert_eq!(user, "user");
        assert_eq!(pass, "pass");
    }

    #[test]
    fn parse_basic_auth_rejects_invalid() {
        assert!(parse_basic_auth("Bearer token").is_none());
        assert!(parse_basic_auth("Basic !!!").is_none());
    }

    #[test]
    fn git_principal_user() {
        let user = AuthUser {
            id: Uuid::new_v4(),
            username: "alice".into(),
        };
        assert!(GitPrincipal::User(user.clone()).user().is_some());
        assert!(GitPrincipal::DeployKey {
            fingerprint: "fp".into()
        }
        .user()
        .is_none());
    }
}
