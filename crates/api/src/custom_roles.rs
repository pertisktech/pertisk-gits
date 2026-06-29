use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{delete, get, patch, post},
    Json, Router,
};
use pertisk_domain::{models::*, permissions::CustomRolePermissions, DomainError};
use serde::Serialize;
use uuid::Uuid;
use validator::Validate;

use crate::{find_org_for_member, permissions, ApiError, AppState, AuthUser};

pub fn custom_role_routes() -> Router<AppState> {
    Router::new()
        .route(
            "/organizations/{org_path}/custom-roles",
            get(list_custom_roles).post(create_custom_role),
        )
        .route(
            "/organizations/{org_path}/custom-roles/{role_slug}",
            patch(update_custom_role).delete(delete_custom_role),
        )
}

#[derive(Serialize)]
struct CustomRoleResponse {
    id: Uuid,
    name: String,
    slug: String,
    description: Option<String>,
    permissions: CustomRolePermissions,
    created_at: chrono::DateTime<chrono::Utc>,
    updated_at: chrono::DateTime<chrono::Utc>,
}

async fn list_custom_roles(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(org_path): Path<String>,
) -> Result<Json<Vec<CustomRoleResponse>>, ApiError> {
    let org = find_org_for_member(&state.pool, &crate::org::org_path_from_param(&org_path), auth.user_id).await?;

    let rows = sqlx::query_as::<_, OrganizationCustomRole>(
        r#"
        SELECT id, organization_id, name, slug, description, permissions, created_at, updated_at
        FROM organization_custom_roles
        WHERE organization_id = $1
        ORDER BY name
        "#,
    )
    .bind(org.id)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    Ok(Json(rows.into_iter().map(CustomRoleResponse::from).collect()))
}

async fn create_custom_role(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(org_path): Path<String>,
    Json(body): Json<CreateCustomRoleRequest>,
) -> Result<(StatusCode, Json<CustomRoleResponse>), ApiError> {
    body.validate()
        .map_err(|e| ApiError::from(DomainError::Validation(e.to_string())))?;

    let org = find_org_for_member(&state.pool, &crate::org::org_path_from_param(&org_path), auth.user_id).await?;
    permissions::ensure_can_manage_custom_roles(&state.pool, org.id, auth.user_id).await?;

    let slug = body
        .slug
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .unwrap_or_else(|| slugify_name(&body.name));

    let row = sqlx::query_as::<_, OrganizationCustomRole>(
        r#"
        INSERT INTO organization_custom_roles (organization_id, name, slug, description, permissions)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, organization_id, name, slug, description, permissions, created_at, updated_at
        "#,
    )
    .bind(org.id)
    .bind(body.name.trim())
    .bind(&slug)
    .bind(body.description.as_deref().filter(|value| !value.trim().is_empty()))
    .bind(sqlx::types::Json(body.permissions))
    .fetch_one(&state.pool)
    .await
    .map_err(|e| map_unique_violation(e, "custom role with this name or slug already exists"))?;

    Ok((StatusCode::CREATED, Json(CustomRoleResponse::from(row))))
}

async fn update_custom_role(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_path, role_slug)): Path<(String, String)>,
    Json(body): Json<UpdateCustomRoleRequest>,
) -> Result<Json<CustomRoleResponse>, ApiError> {
    body.validate()
        .map_err(|e| ApiError::from(DomainError::Validation(e.to_string())))?;

    if body.name.is_none() && body.description.is_none() && body.permissions.is_none() {
        return Err(DomainError::Validation("no fields to update".into()).into());
    }

    let org = find_org_for_member(&state.pool, &crate::org::org_path_from_param(&org_path), auth.user_id).await?;
    permissions::ensure_can_manage_custom_roles(&state.pool, org.id, auth.user_id).await?;

    let existing = find_custom_role(&state.pool, org.id, &role_slug).await?;

    let name = body.name.as_deref().unwrap_or(&existing.name).trim().to_string();
    let description = match body.description {
        Some(value) if value.trim().is_empty() => None,
        Some(value) => Some(value),
        None => existing.description.clone(),
    };
    let permissions_value = body
        .permissions
        .map(sqlx::types::Json)
        .unwrap_or(existing.permissions);

    let row = sqlx::query_as::<_, OrganizationCustomRole>(
        r#"
        UPDATE organization_custom_roles
        SET name = $1, description = $2, permissions = $3, updated_at = now()
        WHERE id = $4
        RETURNING id, organization_id, name, slug, description, permissions, created_at, updated_at
        "#,
    )
    .bind(&name)
    .bind(&description)
    .bind(permissions_value)
    .bind(existing.id)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| map_unique_violation(e, "custom role with this name already exists"))?;

    Ok(Json(CustomRoleResponse::from(row)))
}

async fn delete_custom_role(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_path, role_slug)): Path<(String, String)>,
) -> Result<StatusCode, ApiError> {
    let org = find_org_for_member(&state.pool, &crate::org::org_path_from_param(&org_path), auth.user_id).await?;
    permissions::ensure_can_manage_custom_roles(&state.pool, org.id, auth.user_id).await?;

    let existing = find_custom_role(&state.pool, org.id, &role_slug).await?;

    let deleted = sqlx::query(
        r#"
        DELETE FROM organization_custom_roles
        WHERE id = $1 AND organization_id = $2
        "#,
    )
    .bind(existing.id)
    .bind(org.id)
    .execute(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    if deleted.rows_affected() == 0 {
        return Err(DomainError::NotFound.into());
    }

    Ok(StatusCode::NO_CONTENT)
}

impl From<OrganizationCustomRole> for CustomRoleResponse {
    fn from(row: OrganizationCustomRole) -> Self {
        Self {
            id: row.id,
            name: row.name,
            slug: row.slug,
            description: row.description,
            permissions: row.permissions.0,
            created_at: row.created_at,
            updated_at: row.updated_at,
        }
    }
}

async fn find_custom_role(
    pool: &sqlx::PgPool,
    org_id: Uuid,
    role_slug: &str,
) -> Result<OrganizationCustomRole, ApiError> {
    sqlx::query_as::<_, OrganizationCustomRole>(
        r#"
        SELECT id, organization_id, name, slug, description, permissions, created_at, updated_at
        FROM organization_custom_roles
        WHERE organization_id = $1 AND slug = $2
        "#,
    )
    .bind(org_id)
    .bind(role_slug)
    .fetch_optional(pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?
    .ok_or(DomainError::NotFound.into())
}

fn slugify_name(name: &str) -> String {
    let slug: String = name
        .trim()
        .to_ascii_lowercase()
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '-' })
        .collect();
    let slug = slug
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    if slug.is_empty() {
        "role".into()
    } else {
        slug
    }
}

fn map_unique_violation(error: sqlx::Error, message: &str) -> ApiError {
    if let sqlx::Error::Database(db_err) = &error {
        if db_err.is_unique_violation() {
            return ApiError::from(DomainError::Validation(message.into()));
        }
    }
    ApiError::from(DomainError::Internal(error.to_string()))
}
