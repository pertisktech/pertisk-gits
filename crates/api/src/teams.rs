use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{delete, get, patch, post},
    Json, Router,
};
use pertisk_domain::{models::*, DomainError};
use serde::Serialize;
use uuid::Uuid;
use validator::Validate;

use crate::{
    find_org_for_member, permissions, permissions::UserExt, ApiError, AppState, AuthUser,
};

pub fn team_routes() -> Router<AppState> {
    Router::new()
        .route(
            "/organizations/{org_slug}/teams",
            get(list_teams).post(create_team),
        )
        .route(
            "/organizations/{org_slug}/teams/{team_slug}",
            get(get_team).patch(update_team).delete(delete_team),
        )
        .route(
            "/organizations/{org_slug}/teams/{team_slug}/members",
            get(list_team_members).post(add_team_member),
        )
        .route(
            "/organizations/{org_slug}/teams/{team_slug}/members/{user_id}",
            delete(remove_team_member),
        )
        .route(
            "/organizations/{org_slug}/teams/{team_slug}/repositories",
            get(list_team_repositories).post(set_team_repository_access),
        )
        .route(
            "/organizations/{org_slug}/teams/{team_slug}/repositories/{repo_slug}",
            delete(remove_team_repository_access),
        )
        .route(
            "/organizations/{org_slug}/repositories/{repo_slug}/team-access",
            get(list_repository_team_access),
        )
}

#[derive(Serialize)]
struct TeamSummaryResponse {
    id: Uuid,
    name: String,
    slug: String,
    description: Option<String>,
    member_count: i64,
    repository_count: i64,
    created_at: chrono::DateTime<chrono::Utc>,
    updated_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Serialize)]
struct TeamDetailResponse {
    id: Uuid,
    name: String,
    slug: String,
    description: Option<String>,
    created_at: chrono::DateTime<chrono::Utc>,
    updated_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Serialize)]
struct TeamMemberResponse {
    user: UserPublic,
    created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Serialize)]
struct TeamRepositoryAccessResponse {
    repository_id: Uuid,
    repo_slug: String,
    repo_name: String,
    role: RepoRole,
    created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Serialize)]
struct RepositoryTeamAccessResponse {
    team_id: Uuid,
    team_slug: String,
    team_name: String,
    role: RepoRole,
}

async fn list_teams(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(org_slug): Path<String>,
) -> Result<Json<Vec<TeamSummaryResponse>>, ApiError> {
    let org = find_org_for_member(&state.pool, &org_slug, auth.user_id).await?;

    let rows = sqlx::query_as::<_, (
        Uuid,
        String,
        String,
        Option<String>,
        i64,
        i64,
        chrono::DateTime<chrono::Utc>,
        chrono::DateTime<chrono::Utc>,
    )>(
        r#"
        SELECT
            t.id,
            t.name,
            t.slug,
            t.description,
            (SELECT COUNT(*) FROM team_members tm WHERE tm.team_id = t.id) AS member_count,
            (SELECT COUNT(*) FROM team_repository_permissions trp WHERE trp.team_id = t.id) AS repository_count,
            t.created_at,
            t.updated_at
        FROM teams t
        WHERE t.organization_id = $1
        ORDER BY t.name
        "#,
    )
    .bind(org.id)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    Ok(Json(
        rows.into_iter()
            .map(
                |(id, name, slug, description, member_count, repository_count, created_at, updated_at)| {
                    TeamSummaryResponse {
                        id,
                        name,
                        slug,
                        description,
                        member_count,
                        repository_count,
                        created_at,
                        updated_at,
                    }
                },
            )
            .collect(),
    ))
}

async fn create_team(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(org_slug): Path<String>,
    Json(body): Json<CreateTeamRequest>,
) -> Result<(StatusCode, Json<TeamDetailResponse>), ApiError> {
    body.validate()
        .map_err(|e| ApiError::from(DomainError::Validation(e.to_string())))?;

    let org = find_org_for_member(&state.pool, &org_slug, auth.user_id).await?;
    permissions::ensure_can_manage_teams(&state.pool, org.id, auth.user_id).await?;

    let slug = body
        .slug
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .unwrap_or_else(|| slugify_name(&body.name));

    let row = sqlx::query_as::<_, Team>(
        r#"
        INSERT INTO teams (organization_id, name, slug, description)
        VALUES ($1, $2, $3, $4)
        RETURNING id, organization_id, name, slug, description, created_at, updated_at
        "#,
    )
    .bind(org.id)
    .bind(body.name.trim())
    .bind(&slug)
    .bind(body.description.as_deref().filter(|value| !value.trim().is_empty()))
    .fetch_one(&state.pool)
    .await
    .map_err(|e| map_unique_violation(e, "team with this name or slug already exists"))?;

    Ok((StatusCode::CREATED, Json(TeamDetailResponse::from(row))))
}

async fn get_team(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_slug, team_slug)): Path<(String, String)>,
) -> Result<Json<TeamDetailResponse>, ApiError> {
    let org = find_org_for_member(&state.pool, &org_slug, auth.user_id).await?;
    let team = find_team(&state.pool, org.id, &team_slug).await?;
    Ok(Json(TeamDetailResponse::from(team)))
}

async fn update_team(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_slug, team_slug)): Path<(String, String)>,
    Json(body): Json<UpdateTeamRequest>,
) -> Result<Json<TeamDetailResponse>, ApiError> {
    body.validate()
        .map_err(|e| ApiError::from(DomainError::Validation(e.to_string())))?;

    if body.name.is_none() && body.description.is_none() {
        return Err(DomainError::Validation("no fields to update".into()).into());
    }

    let org = find_org_for_member(&state.pool, &org_slug, auth.user_id).await?;
    permissions::ensure_can_manage_teams(&state.pool, org.id, auth.user_id).await?;
    let existing = find_team(&state.pool, org.id, &team_slug).await?;

    let name = body.name.as_deref().unwrap_or(&existing.name).trim().to_string();
    let description = match body.description {
        Some(value) if value.trim().is_empty() => None,
        Some(value) => Some(value),
        None => existing.description.clone(),
    };

    let row = sqlx::query_as::<_, Team>(
        r#"
        UPDATE teams
        SET name = $1, description = $2, updated_at = now()
        WHERE id = $3
        RETURNING id, organization_id, name, slug, description, created_at, updated_at
        "#,
    )
    .bind(&name)
    .bind(&description)
    .bind(existing.id)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| map_unique_violation(e, "team with this name already exists"))?;

    Ok(Json(TeamDetailResponse::from(row)))
}

async fn delete_team(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_slug, team_slug)): Path<(String, String)>,
) -> Result<StatusCode, ApiError> {
    let org = find_org_for_member(&state.pool, &org_slug, auth.user_id).await?;
    permissions::ensure_can_manage_teams(&state.pool, org.id, auth.user_id).await?;
    let team = find_team(&state.pool, org.id, &team_slug).await?;

    sqlx::query("DELETE FROM teams WHERE id = $1 AND organization_id = $2")
        .bind(team.id)
        .bind(org.id)
        .execute(&state.pool)
        .await
        .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    Ok(StatusCode::NO_CONTENT)
}

async fn list_team_members(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_slug, team_slug)): Path<(String, String)>,
) -> Result<Json<Vec<TeamMemberResponse>>, ApiError> {
    let org = find_org_for_member(&state.pool, &org_slug, auth.user_id).await?;
    let team = find_team(&state.pool, org.id, &team_slug).await?;

    let rows = sqlx::query_as::<_, (Uuid, String, String, Option<String>, chrono::DateTime<chrono::Utc>, chrono::DateTime<chrono::Utc>)>(
        r#"
        SELECT u.id, u.username, u.email, u.display_name, u.created_at, tm.created_at
        FROM team_members tm
        INNER JOIN users u ON u.id = tm.user_id
        WHERE tm.team_id = $1
        ORDER BY u.username
        "#,
    )
    .bind(team.id)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    Ok(Json(
        rows.into_iter()
            .map(|(id, username, email, display_name, user_created_at, joined_at)| TeamMemberResponse {
                user: UserPublic {
                    id,
                    username,
                    email,
                    display_name,
                    created_at: user_created_at,
                },
                created_at: joined_at,
            })
            .collect(),
    ))
}

async fn add_team_member(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_slug, team_slug)): Path<(String, String)>,
    Json(body): Json<AddTeamMemberRequest>,
) -> Result<(StatusCode, Json<TeamMemberResponse>), ApiError> {
    body.validate()
        .map_err(|e| ApiError::from(DomainError::Validation(e.to_string())))?;

    let org = find_org_for_member(&state.pool, &org_slug, auth.user_id).await?;
    permissions::ensure_can_manage_teams(&state.pool, org.id, auth.user_id).await?;
    let team = find_team(&state.pool, org.id, &team_slug).await?;
    let user = permissions::resolve_user_for_add(&state.pool, body.user_id, body.username).await?;

    ensure_org_member(&state.pool, org.id, user.id).await?;

    let inserted = sqlx::query_scalar::<_, bool>(
        r#"
        INSERT INTO team_members (team_id, user_id)
        VALUES ($1, $2)
        ON CONFLICT DO NOTHING
        RETURNING TRUE
        "#,
    )
    .bind(team.id)
    .bind(user.id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    if inserted.is_none() {
        return Err(DomainError::Conflict("user is already on this team".into()).into());
    }

    let joined_at = sqlx::query_scalar(
        "SELECT created_at FROM team_members WHERE team_id = $1 AND user_id = $2",
    )
    .bind(team.id)
    .bind(user.id)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    Ok((
        StatusCode::CREATED,
        Json(TeamMemberResponse {
            user: user.into_public(),
            created_at: joined_at,
        }),
    ))
}

async fn remove_team_member(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_slug, team_slug, user_id)): Path<(String, String, Uuid)>,
) -> Result<StatusCode, ApiError> {
    let org = find_org_for_member(&state.pool, &org_slug, auth.user_id).await?;
    permissions::ensure_can_manage_teams(&state.pool, org.id, auth.user_id).await?;
    let team = find_team(&state.pool, org.id, &team_slug).await?;

    let deleted = sqlx::query(
        "DELETE FROM team_members WHERE team_id = $1 AND user_id = $2",
    )
    .bind(team.id)
    .bind(user_id)
    .execute(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    if deleted.rows_affected() == 0 {
        return Err(DomainError::NotFound.into());
    }

    Ok(StatusCode::NO_CONTENT)
}

async fn list_team_repositories(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_slug, team_slug)): Path<(String, String)>,
) -> Result<Json<Vec<TeamRepositoryAccessResponse>>, ApiError> {
    let org = find_org_for_member(&state.pool, &org_slug, auth.user_id).await?;
    let team = find_team(&state.pool, org.id, &team_slug).await?;

    let rows = sqlx::query_as::<_, (Uuid, String, String, RepoRole, chrono::DateTime<chrono::Utc>)>(
        r#"
        SELECT r.id, r.slug, r.name, trp.role, trp.created_at
        FROM team_repository_permissions trp
        INNER JOIN repositories r ON r.id = trp.repository_id
        WHERE trp.team_id = $1
        ORDER BY r.slug
        "#,
    )
    .bind(team.id)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    Ok(Json(
        rows.into_iter()
            .map(|(repository_id, repo_slug, repo_name, role, created_at)| {
                TeamRepositoryAccessResponse {
                    repository_id,
                    repo_slug,
                    repo_name,
                    role,
                    created_at,
                }
            })
            .collect(),
    ))
}

async fn set_team_repository_access(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_slug, team_slug)): Path<(String, String)>,
    Json(body): Json<SetTeamRepositoryAccessRequest>,
) -> Result<(StatusCode, Json<TeamRepositoryAccessResponse>), ApiError> {
    body.validate()
        .map_err(|e| ApiError::from(DomainError::Validation(e.to_string())))?;

    let org = find_org_for_member(&state.pool, &org_slug, auth.user_id).await?;
    permissions::ensure_can_manage_teams(&state.pool, org.id, auth.user_id).await?;
    let team = find_team(&state.pool, org.id, &team_slug).await?;
    let repo = permissions::find_repo_in_org(&state.pool, org.id, &body.repo_slug).await?;

    sqlx::query(
        r#"
        INSERT INTO team_repository_permissions (team_id, repository_id, role)
        VALUES ($1, $2, $3)
        ON CONFLICT (team_id, repository_id)
        DO UPDATE SET role = EXCLUDED.role
        "#,
    )
    .bind(team.id)
    .bind(repo.id)
    .bind(body.role)
    .execute(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    let row = sqlx::query_as::<_, (Uuid, String, String, RepoRole, chrono::DateTime<chrono::Utc>)>(
        r#"
        SELECT r.id, r.slug, r.name, trp.role, trp.created_at
        FROM team_repository_permissions trp
        INNER JOIN repositories r ON r.id = trp.repository_id
        WHERE trp.team_id = $1 AND trp.repository_id = $2
        "#,
    )
    .bind(team.id)
    .bind(repo.id)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    let (repository_id, repo_slug, repo_name, role, created_at) = row;

    Ok((
        StatusCode::CREATED,
        Json(TeamRepositoryAccessResponse {
            repository_id,
            repo_slug,
            repo_name,
            role,
            created_at,
        }),
    ))
}

async fn remove_team_repository_access(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_slug, team_slug, repo_slug)): Path<(String, String, String)>,
) -> Result<StatusCode, ApiError> {
    let org = find_org_for_member(&state.pool, &org_slug, auth.user_id).await?;
    permissions::ensure_can_manage_teams(&state.pool, org.id, auth.user_id).await?;
    let team = find_team(&state.pool, org.id, &team_slug).await?;
    let repo = permissions::find_repo_in_org(&state.pool, org.id, &repo_slug).await?;

    let deleted = sqlx::query(
        "DELETE FROM team_repository_permissions WHERE team_id = $1 AND repository_id = $2",
    )
    .bind(team.id)
    .bind(repo.id)
    .execute(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    if deleted.rows_affected() == 0 {
        return Err(DomainError::NotFound.into());
    }

    Ok(StatusCode::NO_CONTENT)
}

async fn list_repository_team_access(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_slug, repo_slug)): Path<(String, String)>,
) -> Result<Json<Vec<RepositoryTeamAccessResponse>>, ApiError> {
    let org = find_org_for_member(&state.pool, &org_slug, auth.user_id).await?;
    let repo = permissions::find_repo_in_org(&state.pool, org.id, &repo_slug).await?;
    permissions::ensure_can_admin_repo(&state.pool, org.id, &repo, &auth).await?;

    let rows = sqlx::query_as::<_, (Uuid, String, String, RepoRole)>(
        r#"
        SELECT t.id, t.slug, t.name, trp.role
        FROM team_repository_permissions trp
        INNER JOIN teams t ON t.id = trp.team_id
        WHERE trp.repository_id = $1
        ORDER BY t.name
        "#,
    )
    .bind(repo.id)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    Ok(Json(
        rows.into_iter()
            .map(|(team_id, team_slug, team_name, role)| RepositoryTeamAccessResponse {
                team_id,
                team_slug,
                team_name,
                role,
            })
            .collect(),
    ))
}

impl From<Team> for TeamDetailResponse {
    fn from(row: Team) -> Self {
        Self {
            id: row.id,
            name: row.name,
            slug: row.slug,
            description: row.description,
            created_at: row.created_at,
            updated_at: row.updated_at,
        }
    }
}

async fn find_team(pool: &sqlx::PgPool, org_id: Uuid, team_slug: &str) -> Result<Team, ApiError> {
    sqlx::query_as::<_, Team>(
        r#"
        SELECT id, organization_id, name, slug, description, created_at, updated_at
        FROM teams
        WHERE organization_id = $1 AND slug = $2
        "#,
    )
    .bind(org_id)
    .bind(team_slug)
    .fetch_optional(pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?
    .ok_or(DomainError::NotFound.into())
}

async fn ensure_org_member(pool: &sqlx::PgPool, org_id: Uuid, user_id: Uuid) -> Result<(), ApiError> {
    let exists = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM organization_members WHERE organization_id = $1 AND user_id = $2)",
    )
    .bind(org_id)
    .bind(user_id)
    .fetch_one(pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    if exists {
        Ok(())
    } else {
        Err(DomainError::Validation("user must be a group member before joining a team".into()).into())
    }
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
        "team".into()
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
