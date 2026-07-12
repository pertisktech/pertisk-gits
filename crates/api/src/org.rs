use axum::extract::Path;
use pertisk_domain::org_path::normalize_org_path;
use sqlx::PgPool;
use uuid::Uuid;

use pertisk_domain::{models::Organization, DomainError};

use crate::ApiError;

pub use pertisk_domain::org_groups::{
    ensure_org_chain, find_org_by_full_path, import_repo_slug, import_target_org_path, ORG_COLUMNS,
};

/// Normalize axum `*org_path` capture (may include a leading slash).
pub fn org_path_from_param(org_path: &str) -> String {
    normalize_org_path(org_path)
}

pub async fn find_org_by_path(pool: &PgPool, org_path: &str) -> Result<Organization, ApiError> {
    find_org_by_full_path(pool, &org_path_from_param(org_path))
        .await
        .map_err(ApiError::from)?
        .ok_or(DomainError::NotFound.into())
}

/// User must be a member of this group or any ancestor (GitLab-style inheritance).
pub async fn find_org_for_member(
    pool: &PgPool,
    org_path: &str,
    user_id: Uuid,
) -> Result<Organization, ApiError> {
    let org_path = org_path_from_param(org_path);
    let org = find_org_by_full_path(pool, &org_path)
        .await
        .map_err(ApiError::from)?
        .ok_or(DomainError::NotFound)?;

    if !is_org_member(pool, org.id, user_id).await? {
        return Err(DomainError::Forbidden.into());
    }

    Ok(org)
}

pub async fn is_org_member(pool: &PgPool, org_id: Uuid, user_id: Uuid) -> Result<bool, ApiError> {
    let is_member: bool = sqlx::query_scalar(
        r#"
        WITH RECURSIVE ancestors AS (
            SELECT id, parent_id
            FROM organizations
            WHERE id = $1
            UNION ALL
            SELECT o.id, o.parent_id
            FROM organizations o
            INNER JOIN ancestors a ON o.id = a.parent_id
        )
        SELECT EXISTS (
            SELECT 1
            FROM organization_members m
            WHERE m.user_id = $2
              AND m.organization_id IN (SELECT id FROM ancestors)
        )
        "#,
    )
    .bind(org_id)
    .bind(user_id)
    .fetch_one(pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    Ok(is_member)
}

pub async fn list_subgroups(
    pool: &PgPool,
    parent_id: Uuid,
) -> Result<Vec<Organization>, ApiError> {
    sqlx::query_as::<_, Organization>(&format!(
        r#"
        SELECT {ORG_COLUMNS}
        FROM organizations
        WHERE parent_id = $1
        ORDER BY name
        "#
    ))
    .bind(parent_id)
    .fetch_all(pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))
}

/// Path extractor that normalizes nested group paths.
pub type OrgPath = Path<String>;

pub fn org_path_string(path: OrgPath) -> String {
    org_path_from_param(&path.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn org_path_from_param_strips_leading_slash() {
        assert_eq!(org_path_from_param("/a/b/c"), "a/b/c");
        assert_eq!(org_path_from_param("a/b"), "a/b");
        assert_eq!(org_path_from_param("  /x/  "), "x");
    }
}
