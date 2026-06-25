use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{get, patch, post},
    Json, Router,
};
use pertisk_domain::{models::*, DomainError};
use serde::Serialize;
use sqlx::PgPool;
use uuid::Uuid;
use validator::Validate;

use crate::{find_org_for_member, ApiError, AppState, AuthUser};

pub fn permissions_routes() -> Router<AppState> {
    Router::new()
        .route(
            "/organizations/{org_slug}/members",
            post(add_organization_member),
        )
        .route(
            "/organizations/{org_slug}/members/{user_id}",
            patch(update_organization_member).delete(remove_organization_member),
        )
        .route(
            "/organizations/{org_slug}/repositories/{repo_slug}/collaborators",
            get(list_repository_collaborators).post(add_repository_collaborator),
        )
        .route(
            "/organizations/{org_slug}/repositories/{repo_slug}/collaborators/{user_id}",
            patch(update_repository_collaborator).delete(remove_repository_collaborator),
        )
}

#[derive(Serialize)]
struct OrgMemberResponse {
    user: UserPublic,
    role: OrgRole,
}

#[derive(Serialize)]
struct RepoCollaboratorResponse {
    user: UserPublic,
    role: RepoRole,
}

async fn add_organization_member(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(org_slug): Path<String>,
    Json(body): Json<AddOrganizationMemberRequest>,
) -> Result<(StatusCode, Json<OrgMemberResponse>), ApiError> {
    body.validate()
        .map_err(|e| ApiError::from(DomainError::Validation(e.to_string())))?;

    let org = find_org_for_member(&state.pool, &org_slug, auth.user_id).await?;
    let actor_role = ensure_can_manage_org(&state.pool, org.id, auth.user_id).await?;

    let role = body.role.unwrap_or(OrgRole::Member);
    if role == OrgRole::Owner && actor_role != OrgRole::Owner {
        return Err(DomainError::Forbidden.into());
    }

    let user = resolve_user_for_add(&state.pool, body.user_id, body.username).await?;

    let inserted = sqlx::query_scalar::<_, bool>(
        r#"
        INSERT INTO organization_members (organization_id, user_id, role)
        VALUES ($1, $2, $3)
        ON CONFLICT (organization_id, user_id) DO NOTHING
        RETURNING TRUE
        "#,
    )
    .bind(org.id)
    .bind(user.id)
    .bind(role)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    if inserted.is_none() {
        return Err(DomainError::Conflict("user is already a group member".into()).into());
    }

    let _ = crate::audit::record_audit_event(
        &state.pool,
        crate::audit::AuditEventInput {
            organization_id: Some(org.id),
            actor_user_id: Some(auth.user_id),
            event_type: pertisk_domain::models::AuditEventType::PermissionChange,
            action: format!("added @{} as {role:?}", user.username),
            resource_type: Some("organization_member".into()),
            resource_id: Some(user.id.to_string()),
            metadata: Some(serde_json::json!({ "role": role })),
            ip_address: None,
            user_agent: None,
        },
    )
    .await;

    Ok((
        StatusCode::CREATED,
        Json(OrgMemberResponse {
            user: user.into_public(),
            role,
        }),
    ))
}

async fn update_organization_member(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_slug, target_user_id)): Path<(String, Uuid)>,
    Json(body): Json<UpdateOrganizationMemberRequest>,
) -> Result<Json<OrgMemberResponse>, ApiError> {
    let org = find_org_for_member(&state.pool, &org_slug, auth.user_id).await?;
    let actor_role = ensure_can_manage_org(&state.pool, org.id, auth.user_id).await?;

    let target_role = get_org_member_role(&state.pool, org.id, target_user_id)
        .await?
        .ok_or(DomainError::NotFound)?;

    if target_role == OrgRole::Owner && actor_role != OrgRole::Owner {
        return Err(DomainError::Forbidden.into());
    }

    if body.role == OrgRole::Owner && actor_role != OrgRole::Owner {
        return Err(DomainError::Forbidden.into());
    }

    if target_role == OrgRole::Owner && body.role != OrgRole::Owner {
        ensure_org_has_other_owner(&state.pool, org.id, target_user_id).await?;
    }

    sqlx::query(
        r#"
        UPDATE organization_members
        SET role = $1
        WHERE organization_id = $2 AND user_id = $3
        "#,
    )
    .bind(body.role)
    .bind(org.id)
    .bind(target_user_id)
    .execute(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    let user = find_user_by_id(&state.pool, target_user_id).await?;

    let _ = crate::audit::record_audit_event(
        &state.pool,
        crate::audit::AuditEventInput {
            organization_id: Some(org.id),
            actor_user_id: Some(auth.user_id),
            event_type: pertisk_domain::models::AuditEventType::PermissionChange,
            action: format!("updated @{} role to {:?}", user.username, body.role),
            resource_type: Some("organization_member".into()),
            resource_id: Some(user.id.to_string()),
            metadata: Some(serde_json::json!({ "role": body.role })),
            ip_address: None,
            user_agent: None,
        },
    )
    .await;

    Ok(Json(OrgMemberResponse {
        user: user.into_public(),
        role: body.role,
    }))
}

async fn remove_organization_member(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_slug, target_user_id)): Path<(String, Uuid)>,
) -> Result<StatusCode, ApiError> {
    let org = find_org_for_member(&state.pool, &org_slug, auth.user_id).await?;
    let actor_role = ensure_can_manage_org(&state.pool, org.id, auth.user_id).await?;

    let target_role = get_org_member_role(&state.pool, org.id, target_user_id)
        .await?
        .ok_or(DomainError::NotFound)?;

    if target_role == OrgRole::Owner && actor_role != OrgRole::Owner {
        return Err(DomainError::Forbidden.into());
    }

    if target_role == OrgRole::Owner {
        ensure_org_has_other_owner(&state.pool, org.id, target_user_id).await?;
    }

    let target_user = find_user_by_id(&state.pool, target_user_id).await?;

    sqlx::query(
        r#"
        DELETE FROM organization_members
        WHERE organization_id = $1 AND user_id = $2
        "#,
    )
    .bind(org.id)
    .bind(target_user_id)
    .execute(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    let _ = crate::audit::record_audit_event(
        &state.pool,
        crate::audit::AuditEventInput {
            organization_id: Some(org.id),
            actor_user_id: Some(auth.user_id),
            event_type: pertisk_domain::models::AuditEventType::PermissionChange,
            action: format!("removed @{} from group", target_user.username),
            resource_type: Some("organization_member".into()),
            resource_id: Some(target_user_id.to_string()),
            metadata: None,
            ip_address: None,
            user_agent: None,
        },
    )
    .await;

    Ok(StatusCode::NO_CONTENT)
}

async fn list_repository_collaborators(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_slug, repo_slug)): Path<(String, String)>,
) -> Result<Json<Vec<RepoCollaboratorResponse>>, ApiError> {
    let org = find_org_for_member(&state.pool, &org_slug, auth.user_id).await?;
    let repo = find_repo_in_org(&state.pool, org.id, &repo_slug).await?;
    ensure_can_admin_repo(&state.pool, org.id, &repo, &auth).await?;

    let rows = sqlx::query_as::<_, (Uuid, String, String, Option<String>, chrono::DateTime<chrono::Utc>, RepoRole)>(
        r#"
        SELECT u.id, u.username, u.email, u.display_name, u.created_at, rp.role
        FROM repository_permissions rp
        INNER JOIN users u ON u.id = rp.user_id
        WHERE rp.repository_id = $1
        ORDER BY u.username
        "#,
    )
    .bind(repo.id)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    Ok(Json(
        rows.into_iter()
            .map(|(id, username, email, display_name, created_at, role)| RepoCollaboratorResponse {
                user: UserPublic {
                    id,
                    username,
                    email,
                    display_name,
                    created_at,
                },
                role,
            })
            .collect(),
    ))
}

async fn add_repository_collaborator(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_slug, repo_slug)): Path<(String, String)>,
    Json(body): Json<AddRepositoryCollaboratorRequest>,
) -> Result<(StatusCode, Json<RepoCollaboratorResponse>), ApiError> {
    body.validate()
        .map_err(|e| ApiError::from(DomainError::Validation(e.to_string())))?;

    let org = find_org_for_member(&state.pool, &org_slug, auth.user_id).await?;
    let repo = find_repo_in_org(&state.pool, org.id, &repo_slug).await?;
    ensure_can_admin_repo(&state.pool, org.id, &repo, &auth).await?;

    let role = body.role.unwrap_or(RepoRole::Read);
    let user = resolve_user_for_add(&state.pool, body.user_id, body.username).await?;

    let inserted = sqlx::query_scalar::<_, bool>(
        r#"
        INSERT INTO repository_permissions (repository_id, user_id, role)
        VALUES ($1, $2, $3)
        ON CONFLICT (repository_id, user_id) DO NOTHING
        RETURNING TRUE
        "#,
    )
    .bind(repo.id)
    .bind(user.id)
    .bind(role)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    if inserted.is_none() {
        return Err(
            DomainError::Conflict("user already has direct repository access".into()).into(),
        );
    }

    Ok((
        StatusCode::CREATED,
        Json(RepoCollaboratorResponse {
            user: user.into_public(),
            role,
        }),
    ))
}

async fn update_repository_collaborator(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_slug, repo_slug, target_user_id)): Path<(String, String, Uuid)>,
    Json(body): Json<UpdateRepositoryCollaboratorRequest>,
) -> Result<Json<RepoCollaboratorResponse>, ApiError> {
    let org = find_org_for_member(&state.pool, &org_slug, auth.user_id).await?;
    let repo = find_repo_in_org(&state.pool, org.id, &repo_slug).await?;
    ensure_can_admin_repo(&state.pool, org.id, &repo, &auth).await?;

    let updated = sqlx::query(
        r#"
        UPDATE repository_permissions
        SET role = $1
        WHERE repository_id = $2 AND user_id = $3
        "#,
    )
    .bind(body.role)
    .bind(repo.id)
    .bind(target_user_id)
    .execute(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    if updated.rows_affected() == 0 {
        return Err(DomainError::NotFound.into());
    }

    let user = find_user_by_id(&state.pool, target_user_id).await?;

    Ok(Json(RepoCollaboratorResponse {
        user: user.into_public(),
        role: body.role,
    }))
}

async fn remove_repository_collaborator(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_slug, repo_slug, target_user_id)): Path<(String, String, Uuid)>,
) -> Result<StatusCode, ApiError> {
    let org = find_org_for_member(&state.pool, &org_slug, auth.user_id).await?;
    let repo = find_repo_in_org(&state.pool, org.id, &repo_slug).await?;
    ensure_can_admin_repo(&state.pool, org.id, &repo, &auth).await?;

    let deleted = sqlx::query(
        r#"
        DELETE FROM repository_permissions
        WHERE repository_id = $1 AND user_id = $2
        "#,
    )
    .bind(repo.id)
    .bind(target_user_id)
    .execute(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    if deleted.rows_affected() == 0 {
        return Err(DomainError::NotFound.into());
    }

    Ok(StatusCode::NO_CONTENT)
}

async fn ensure_can_manage_org(
    pool: &PgPool,
    org_id: Uuid,
    user_id: Uuid,
) -> Result<OrgRole, ApiError> {
    let role = get_org_member_role(pool, org_id, user_id)
        .await?
        .ok_or(DomainError::Forbidden)?;

    match role {
        OrgRole::Owner | OrgRole::Admin => Ok(role),
        OrgRole::Member => Err(DomainError::Forbidden.into()),
    }
}

pub(crate) async fn ensure_can_admin_repo(
    pool: &PgPool,
    org_id: Uuid,
    repo: &Repository,
    auth: &AuthUser,
) -> Result<(), ApiError> {
    if sqlx::query_scalar::<_, bool>(
        r#"
        SELECT EXISTS(
            SELECT 1 FROM repository_permissions
            WHERE repository_id = $1 AND user_id = $2 AND role = 'admin'
        )
        "#,
    )
    .bind(repo.id)
    .bind(auth.user_id)
    .fetch_one(pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?
    {
        return Ok(());
    }

    let role = get_org_member_role(pool, org_id, auth.user_id)
        .await?
        .ok_or(DomainError::Forbidden)?;

    match role {
        OrgRole::Owner | OrgRole::Admin => Ok(()),
        OrgRole::Member => Err(DomainError::Forbidden.into()),
    }
}

async fn get_org_member_role(
    pool: &PgPool,
    org_id: Uuid,
    user_id: Uuid,
) -> Result<Option<OrgRole>, ApiError> {
    sqlx::query_scalar::<_, OrgRole>(
        r#"
        SELECT role FROM organization_members
        WHERE organization_id = $1 AND user_id = $2
        "#,
    )
    .bind(org_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))
}

async fn ensure_org_has_other_owner(
    pool: &PgPool,
    org_id: Uuid,
    excluding_user_id: Uuid,
) -> Result<(), ApiError> {
    let other_owners = sqlx::query_scalar::<_, i64>(
        r#"
        SELECT COUNT(*)
        FROM organization_members
        WHERE organization_id = $1 AND role = 'owner' AND user_id <> $2
        "#,
    )
    .bind(org_id)
    .bind(excluding_user_id)
    .fetch_one(pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    if other_owners == 0 {
        return Err(DomainError::Validation(
            "group must have at least one owner".into(),
        )
        .into());
    }

    Ok(())
}

async fn find_repo_in_org(
    pool: &PgPool,
    org_id: Uuid,
    repo_slug: &str,
) -> Result<Repository, ApiError> {
    sqlx::query_as::<_, Repository>(
        r#"
        SELECT id, organization_id, name, slug, description, visibility, default_branch, created_at, updated_at
        FROM repositories
        WHERE organization_id = $1 AND slug = $2
        "#,
    )
    .bind(org_id)
    .bind(repo_slug)
    .fetch_optional(pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?
    .ok_or(DomainError::NotFound.into())
}

async fn find_user_by_username(pool: &PgPool, username: &str) -> Result<User, ApiError> {
    sqlx::query_as::<_, User>(
        r#"
        SELECT id, username, email, password_hash, display_name, created_at, updated_at
        FROM users
        WHERE username = $1
        "#,
    )
    .bind(username)
    .fetch_optional(pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?
    .ok_or(DomainError::NotFound.into())
}

async fn resolve_user_for_add(
    pool: &PgPool,
    user_id: Option<Uuid>,
    username: Option<String>,
) -> Result<User, ApiError> {
    if let Some(user_id) = user_id {
        return find_user_by_id(pool, user_id).await;
    }

    let Some(username) = username else {
        return Err(DomainError::Validation("username or user_id is required".into()).into());
    };

    let username = username.trim();
    if username.is_empty() {
        return Err(DomainError::Validation("username or user_id is required".into()).into());
    }

    find_user_by_username(pool, username).await
}

async fn find_user_by_id(pool: &PgPool, user_id: Uuid) -> Result<User, ApiError> {
    sqlx::query_as::<_, User>(
        r#"
        SELECT id, username, email, password_hash, display_name, created_at, updated_at
        FROM users
        WHERE id = $1
        "#,
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?
    .ok_or(DomainError::NotFound.into())
}

trait UserExt {
    fn into_public(self) -> UserPublic;
}

impl UserExt for User {
    fn into_public(self) -> UserPublic {
        UserPublic {
            id: self.id,
            username: self.username,
            email: self.email,
            display_name: self.display_name,
            created_at: self.created_at,
        }
    }
}
