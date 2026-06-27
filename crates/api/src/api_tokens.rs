use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{delete, get, post},
    Json, Router,
};
use pertisk_domain::{models::*, DomainError};
use rand::RngCore;
use serde::Serialize;
use sqlx::PgPool;
use uuid::Uuid;
use validator::Validate;

use crate::{find_org_for_member, permissions, ApiError, AppState, AuthUser};

pub fn api_token_routes() -> Router<AppState> {
    Router::new()
        .route("/me/tokens", get(list_my_tokens).post(create_my_token))
        .route("/me/tokens/{token_id}", delete(delete_my_token))
        .route(
            "/organizations/{org_slug}/machine-users",
            get(list_machine_users).post(create_machine_user),
        )
}

#[derive(Serialize)]
struct ApiTokenResponse {
    id: Uuid,
    name: String,
    token_prefix: Option<String>,
    scopes: Vec<String>,
    organization_id: Option<Uuid>,
    repository_id: Option<Uuid>,
    last_used_at: Option<chrono::DateTime<chrono::Utc>>,
    expires_at: Option<chrono::DateTime<chrono::Utc>>,
    created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Serialize)]
struct CreateApiTokenResponse {
    token: ApiTokenResponse,
    plaintext: String,
}

#[derive(Serialize)]
struct MachineUserListItem {
    user: UserPublic,
    role: OrgRole,
    token_count: i64,
    latest_token_prefix: Option<String>,
}

#[derive(Serialize)]
struct MachineUserResponse {
    user: UserPublic,
    role: OrgRole,
    token: CreateApiTokenResponse,
}

#[derive(Clone, Debug)]
pub struct ApiTokenAuth {
    pub token_id: Uuid,
    pub user_id: Uuid,
    pub username: String,
    pub organization_id: Option<Uuid>,
    pub repository_id: Option<Uuid>,
    pub scopes: Vec<String>,
}

pub async fn authenticate_api_token(pool: &PgPool, token: &str) -> Result<Option<ApiTokenAuth>, ApiError> {
    let token_hash = hash_api_token(token);
    let row = sqlx::query_as::<_, (Uuid, Uuid, String, Option<Uuid>, Option<Uuid>, Vec<String>, Option<chrono::DateTime<chrono::Utc>>)>(
        r#"
        SELECT t.id, t.user_id, u.username, t.organization_id, t.repository_id, t.scopes, t.expires_at
        FROM api_tokens t
        INNER JOIN users u ON u.id = t.user_id
        WHERE t.token_hash = $1
        "#,
    )
    .bind(&token_hash)
    .fetch_optional(pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    let Some((token_id, user_id, username, organization_id, repository_id, scopes, expires_at)) = row else {
        return Ok(None);
    };

    if let Some(expires_at) = expires_at {
        if expires_at < chrono::Utc::now() {
            return Ok(None);
        }
    }

    let _ = sqlx::query("UPDATE api_tokens SET last_used_at = now() WHERE id = $1")
        .bind(token_id)
        .execute(pool)
        .await;

    Ok(Some(ApiTokenAuth {
        token_id,
        user_id,
        username,
        organization_id,
        repository_id,
        scopes,
    }))
}

async fn list_my_tokens(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<Vec<ApiTokenResponse>>, ApiError> {
    let rows = sqlx::query_as::<_, ApiToken>(
        r#"
        SELECT id, user_id, name, token_hash, token_prefix, scopes, organization_id, repository_id,
               last_used_at, expires_at, created_at
        FROM api_tokens
        WHERE user_id = $1
        ORDER BY created_at DESC
        "#,
    )
    .bind(auth.user_id)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    Ok(Json(rows.into_iter().map(ApiTokenResponse::from).collect()))
}

async fn create_my_token(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(body): Json<CreateApiTokenRequest>,
) -> Result<(StatusCode, Json<CreateApiTokenResponse>), ApiError> {
    body.validate()
        .map_err(|e| ApiError::from(DomainError::Validation(e.to_string())))?;

    if let Some(org_id) = body.organization_id {
        permissions::ensure_org_permission(&state.pool, org_id, auth.user_id, |_| true).await?;
    }

    create_token_for_user(&state.pool, auth.user_id, body).await
}

async fn delete_my_token(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(token_id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    let deleted = sqlx::query(
        "DELETE FROM api_tokens WHERE id = $1 AND user_id = $2",
    )
    .bind(token_id)
    .bind(auth.user_id)
    .execute(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    if deleted.rows_affected() == 0 {
        return Err(DomainError::NotFound.into());
    }

    Ok(StatusCode::NO_CONTENT)
}

async fn list_machine_users(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(org_slug): Path<String>,
) -> Result<Json<Vec<MachineUserListItem>>, ApiError> {
    let org = find_org_for_member(&state.pool, &org_slug, auth.user_id).await?;
    permissions::ensure_can_manage_org(&state.pool, org.id, auth.user_id).await?;

    let rows = sqlx::query_as::<_, (Uuid, String, String, Option<String>, chrono::DateTime<chrono::Utc>, OrgRole, i64, Option<String>)>(
        r#"
        SELECT
            u.id,
            u.username,
            u.email,
            u.display_name,
            u.created_at,
            m.role,
            COUNT(t.id) AS token_count,
            (
                SELECT token_prefix
                FROM api_tokens
                WHERE user_id = u.id
                ORDER BY created_at DESC
                LIMIT 1
            ) AS latest_token_prefix
        FROM organization_members m
        INNER JOIN users u ON u.id = m.user_id
        LEFT JOIN api_tokens t ON t.user_id = u.id
        WHERE m.organization_id = $1 AND u.is_machine_user = TRUE
        GROUP BY u.id, u.username, u.email, u.display_name, u.created_at, m.role
        ORDER BY u.created_at DESC
        "#,
    )
    .bind(org.id)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    Ok(Json(
        rows.into_iter()
            .map(
                |(id, username, email, display_name, created_at, role, token_count, latest_token_prefix)| {
                    MachineUserListItem {
                        user: UserPublic {
                            id,
                            username,
                            email,
                            display_name,
                            created_at,
                        },
                        role,
                        token_count,
                        latest_token_prefix,
                    }
                },
            )
            .collect(),
    ))
}

async fn create_machine_user(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(org_slug): Path<String>,
    Json(body): Json<CreateMachineUserRequest>,
) -> Result<(StatusCode, Json<MachineUserResponse>), ApiError> {
    body.validate()
        .map_err(|e| ApiError::from(DomainError::Validation(e.to_string())))?;

    let org = find_org_for_member(&state.pool, &org_slug, auth.user_id).await?;
    permissions::ensure_can_manage_org(&state.pool, org.id, auth.user_id).await?;

    let username = body.username.trim();
    let email = format!("{username}+machine@internal.local");
    let display_name = body
        .display_name
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
        .or_else(|| Some(format!("Machine: {username}")));

    let user = sqlx::query_as::<_, User>(
        r#"
        INSERT INTO users (username, email, password_hash, display_name, is_machine_user, approval_status, approved_at)
        VALUES ($1, $2, NULL, $3, TRUE, 'approved', NOW())
        RETURNING id, username, email, password_hash, display_name, is_super_admin, is_machine_user,
                  approval_status, approved_at, approved_by, created_at, updated_at
        "#,
    )
    .bind(username)
    .bind(&email)
    .bind(&display_name)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| {
        if let sqlx::Error::Database(db_err) = &e {
            if db_err.is_unique_violation() {
                return ApiError::from(DomainError::Conflict("username already exists".into()));
            }
        }
        ApiError::from(DomainError::Internal(e.to_string()))
    })?;

    let role = body.role.unwrap_or(OrgRole::Member);
    sqlx::query(
        "INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, $3)",
    )
    .bind(org.id)
    .bind(user.id)
    .bind(role)
    .execute(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    let (_, Json(token)) = create_token_for_user(
        &state.pool,
        user.id,
        CreateApiTokenRequest {
            name: body.token_name,
            scopes: if body.scopes.is_empty() {
                vec!["api".into()]
            } else {
                body.scopes
            },
            organization_id: Some(org.id),
            repository_id: None,
            expires_at: None,
        },
    )
    .await?;

    Ok((
        StatusCode::CREATED,
        Json(MachineUserResponse {
            user: UserPublic {
                id: user.id,
                username: user.username,
                email: user.email,
                display_name: user.display_name,
                created_at: user.created_at,
            },
            role,
            token,
        }),
    ))
}

async fn create_token_for_user(
    pool: &PgPool,
    user_id: Uuid,
    body: CreateApiTokenRequest,
) -> Result<(StatusCode, Json<CreateApiTokenResponse>), ApiError> {
    let (plaintext, prefix) = generate_api_token();
    let token_hash = hash_api_token(&plaintext);
    let scopes = if body.scopes.is_empty() {
        vec!["api".to_string()]
    } else {
        body.scopes
    };

    let row = sqlx::query_as::<_, ApiToken>(
        r#"
        INSERT INTO api_tokens (
            user_id, name, token_hash, token_prefix, scopes, organization_id, repository_id, expires_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id, user_id, name, token_hash, token_prefix, scopes, organization_id, repository_id,
                  last_used_at, expires_at, created_at
        "#,
    )
    .bind(user_id)
    .bind(body.name.trim())
    .bind(token_hash)
    .bind(&prefix)
    .bind(&scopes)
    .bind(body.organization_id)
    .bind(body.repository_id)
    .bind(body.expires_at)
    .fetch_one(pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    Ok((
        StatusCode::CREATED,
        Json(CreateApiTokenResponse {
            token: ApiTokenResponse::from(row),
            plaintext,
        }),
    ))
}

impl From<ApiToken> for ApiTokenResponse {
    fn from(row: ApiToken) -> Self {
        Self {
            id: row.id,
            name: row.name,
            token_prefix: row.token_prefix,
            scopes: row.scopes,
            organization_id: row.organization_id,
            repository_id: row.repository_id,
            last_used_at: row.last_used_at,
            expires_at: row.expires_at,
            created_at: row.created_at,
        }
    }
}

fn generate_api_token() -> (String, String) {
    let mut bytes = [0u8; 24];
    rand::thread_rng().fill_bytes(&mut bytes);
    let secret: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    let prefix = secret.chars().take(8).collect::<String>();
    (format!("pgs_{secret}"), prefix)
}

pub fn hash_api_token(token: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    token.hash(&mut hasher);
    format!("{:x}", hasher.finish())
}
