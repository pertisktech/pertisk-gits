use sqlx::PgPool;
use uuid::Uuid;

use crate::error::DomainError;
use crate::models::Organization;
use crate::org_path::{join_org_path, normalize_org_path, org_path_slug};

pub const ORG_COLUMNS: &str =
    "id, slug, name, description, parent_id, full_path, created_at, updated_at";

pub async fn find_org_by_full_path(
    pool: &PgPool,
    full_path: &str,
) -> Result<Option<Organization>, DomainError> {
    let full_path = normalize_org_path(full_path);
    sqlx::query_as::<_, Organization>(&format!(
        "SELECT {ORG_COLUMNS} FROM organizations WHERE full_path = $1"
    ))
    .bind(&full_path)
    .fetch_optional(pool)
    .await
    .map_err(|e| DomainError::Internal(e.to_string()))
}

/// Ensure every segment of `full_path` exists, creating missing subgroups. Returns the leaf org id.
pub async fn ensure_org_chain(
    pool: &PgPool,
    full_path: &str,
    creator_user_id: Uuid,
) -> Result<Uuid, DomainError> {
    let full_path = normalize_org_path(full_path);
    if full_path.is_empty() {
        return Err(DomainError::Validation("group path is required".into()));
    }

    if let Some(org) = find_org_by_full_path(pool, &full_path).await? {
        return Ok(org.id);
    }

    let segments: Vec<&str> = full_path.split('/').filter(|s| !s.is_empty()).collect();
    let mut built = String::new();
    let mut parent_id: Option<Uuid> = None;

    for segment in segments {
        if !built.is_empty() {
            built.push('/');
        }
        built.push_str(segment);

        if let Some(org) = find_org_by_full_path(pool, &built).await? {
            parent_id = Some(org.id);
            continue;
        }

        parent_id = Some(
            create_subgroup(pool, segment, segment, parent_id, &built, creator_user_id).await?,
        );
    }

    parent_id.ok_or_else(|| DomainError::Internal("failed to resolve group path".into()))
}

async fn create_subgroup(
    pool: &PgPool,
    name: &str,
    slug: &str,
    parent_id: Option<Uuid>,
    full_path: &str,
    creator_user_id: Uuid,
) -> Result<Uuid, DomainError> {
    let mut tx = pool
        .begin()
        .await
        .map_err(|e| DomainError::Internal(e.to_string()))?;

    let org_id = sqlx::query_scalar::<_, Uuid>(
        r#"
        INSERT INTO organizations (slug, name, parent_id, full_path)
        VALUES ($1, $2, $3, $4)
        RETURNING id
        "#,
    )
    .bind(slug)
    .bind(name)
    .bind(parent_id)
    .bind(full_path)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| match e {
        sqlx::Error::Database(db) if db.constraint().is_some() => {
            DomainError::Conflict(format!("group path '{full_path}' already exists"))
        }
        other => DomainError::Internal(other.to_string()),
    })?;

    sqlx::query(
        r#"
        INSERT INTO organization_members (organization_id, user_id, role)
        VALUES ($1, $2, 'owner')
        ON CONFLICT (organization_id, user_id) DO NOTHING
        "#,
    )
    .bind(org_id)
    .bind(creator_user_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| DomainError::Internal(e.to_string()))?;

    tx.commit()
        .await
        .map_err(|e| DomainError::Internal(e.to_string()))?;

    Ok(org_id)
}

/// Resolve target org for a GitLab/GitHub `path_with_namespace` import.
pub fn import_target_org_path(target_org_full_path: &str, source_full_name: &str) -> String {
    let target = normalize_org_path(target_org_full_path);
    let source_full_name = normalize_org_path(source_full_name);
    let Some((namespace, _repo)) = source_full_name.rsplit_once('/') else {
        return target;
    };
    if target.is_empty() {
        return namespace.to_string();
    }
    if namespace == target || namespace.starts_with(&format!("{target}/")) {
        namespace.to_string()
    } else {
        join_org_path(&target, namespace)
    }
}

pub fn import_repo_slug(source_full_name: &str) -> String {
    org_path_slug(source_full_name).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn import_paths() {
        assert_eq!(
            import_target_org_path("a", "a/b/c/repo"),
            "a/b/c"
        );
        assert_eq!(
            import_target_org_path("a/b", "a/b/c/repo"),
            "a/b/c"
        );
        assert_eq!(import_repo_slug("a/b/c/repo"), "repo");
    }
}
