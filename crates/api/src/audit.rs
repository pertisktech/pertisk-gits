use axum::{
    extract::{Path, Query, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use chrono::{DateTime, Utc};
use pertisk_domain::{models::*, DomainError};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

use crate::{find_org_for_member, permissions, ApiError, AppState, AuthUser};

pub fn audit_routes() -> Router<AppState> {
    Router::new()
        .route(
            "/organizations/{org_slug}/audit-events",
            get(list_audit_events),
        )
        .route(
            "/organizations/{org_slug}/audit-events/export",
            get(export_audit_events),
        )
}

#[derive(Debug, Deserialize)]
pub struct AuditEventInput {
    pub organization_id: Option<Uuid>,
    pub actor_user_id: Option<Uuid>,
    pub event_type: AuditEventType,
    pub action: String,
    pub resource_type: Option<String>,
    pub resource_id: Option<String>,
    pub metadata: Option<serde_json::Value>,
    pub ip_address: Option<String>,
    pub user_agent: Option<String>,
}

pub async fn record_audit_event(pool: &PgPool, input: AuditEventInput) -> Result<(), ApiError> {
    sqlx::query(
        r#"
        INSERT INTO audit_events (
            organization_id, actor_user_id, event_type, action,
            resource_type, resource_id, metadata, ip_address, user_agent
        )
        VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, '{}'::jsonb), $8::inet, $9)
        "#,
    )
    .bind(input.organization_id)
    .bind(input.actor_user_id)
    .bind(input.event_type)
    .bind(&input.action)
    .bind(&input.resource_type)
    .bind(&input.resource_id)
    .bind(input.metadata.unwrap_or(serde_json::json!({})))
    .bind(&input.ip_address)
    .bind(&input.user_agent)
    .execute(pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    Ok(())
}

#[derive(Debug, Deserialize)]
struct AuditListQuery {
    event_type: Option<AuditEventType>,
    actor_user_id: Option<Uuid>,
    from: Option<DateTime<Utc>>,
    to: Option<DateTime<Utc>>,
    #[serde(default = "default_audit_limit")]
    limit: i64,
    #[serde(default)]
    offset: i64,
}

fn default_audit_limit() -> i64 {
    50
}

/// Org-scoped events plus instance-level auth events from org members (login / SSO).
const AUDIT_ORG_SCOPE_SQL: &str = r#"
(
  organization_id = $1
  OR (
    organization_id IS NULL
    AND actor_user_id IN (
      SELECT user_id FROM organization_members WHERE organization_id = $1
    )
  )
)
"#;

#[derive(Serialize)]
struct AuditEventResponse {
    id: Uuid,
    organization_id: Option<Uuid>,
    actor: Option<UserPublic>,
    event_type: AuditEventType,
    action: String,
    resource_type: Option<String>,
    resource_id: Option<String>,
    metadata: serde_json::Value,
    ip_address: Option<String>,
    user_agent: Option<String>,
    created_at: DateTime<Utc>,
}

#[derive(Serialize)]
struct AuditListResponse {
    events: Vec<AuditEventResponse>,
    total: i64,
}

async fn list_audit_events(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(org_slug): Path<String>,
    Query(query): Query<AuditListQuery>,
) -> Result<Json<AuditListResponse>, ApiError> {
    let org = find_org_for_member(&state.pool, &org_slug, auth.user_id).await?;
    permissions::ensure_can_view_audit(&state.pool, org.id, auth.user_id).await?;

    let limit = query.limit.clamp(1, 200);
    let offset = query.offset.max(0);

    let total: i64 = sqlx::query_scalar(&format!(
        r#"
        SELECT COUNT(*)::bigint
        FROM audit_events
        WHERE {AUDIT_ORG_SCOPE_SQL}
          AND ($2::audit_event_type IS NULL OR event_type = $2)
          AND ($3::uuid IS NULL OR actor_user_id = $3)
          AND ($4::timestamptz IS NULL OR created_at >= $4)
          AND ($5::timestamptz IS NULL OR created_at <= $5)
        "#,
    ))
    .bind(org.id)
    .bind(query.event_type)
    .bind(query.actor_user_id)
    .bind(query.from)
    .bind(query.to)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    let rows = sqlx::query_as::<_, AuditEvent>(&format!(
        r#"
        SELECT
            id, organization_id, actor_user_id, event_type, action,
            resource_type, resource_id, metadata,
            host(ip_address)::text AS ip_address,
            user_agent, created_at
        FROM audit_events
        WHERE {AUDIT_ORG_SCOPE_SQL}
          AND ($2::audit_event_type IS NULL OR event_type = $2)
          AND ($3::uuid IS NULL OR actor_user_id = $3)
          AND ($4::timestamptz IS NULL OR created_at >= $4)
          AND ($5::timestamptz IS NULL OR created_at <= $5)
        ORDER BY created_at DESC
        LIMIT $6 OFFSET $7
        "#,
    ))
    .bind(org.id)
    .bind(query.event_type)
    .bind(query.actor_user_id)
    .bind(query.from)
    .bind(query.to)
    .bind(limit)
    .bind(offset)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    let events = enrich_audit_events(&state.pool, rows).await?;
    Ok(Json(AuditListResponse { events, total }))
}

async fn export_audit_events(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(org_slug): Path<String>,
    Query(query): Query<AuditListQuery>,
) -> Result<Response, ApiError> {
    let org = find_org_for_member(&state.pool, &org_slug, auth.user_id).await?;
    permissions::ensure_can_view_audit(&state.pool, org.id, auth.user_id).await?;

    let rows = sqlx::query_as::<_, AuditEvent>(&format!(
        r#"
        SELECT
            id, organization_id, actor_user_id, event_type, action,
            resource_type, resource_id, metadata,
            host(ip_address)::text AS ip_address,
            user_agent, created_at
        FROM audit_events
        WHERE {AUDIT_ORG_SCOPE_SQL}
          AND ($2::audit_event_type IS NULL OR event_type = $2)
          AND ($3::uuid IS NULL OR actor_user_id = $3)
          AND ($4::timestamptz IS NULL OR created_at >= $4)
          AND ($5::timestamptz IS NULL OR created_at <= $5)
        ORDER BY created_at DESC
        LIMIT 10000
        "#,
    ))
    .bind(org.id)
    .bind(query.event_type)
    .bind(query.actor_user_id)
    .bind(query.from)
    .bind(query.to)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    let events = enrich_audit_events(&state.pool, rows).await?;

    let mut csv = String::from("id,created_at,event_type,action,actor_username,resource_type,resource_id,ip_address\n");
    for event in events {
        let actor = event
            .actor
            .as_ref()
            .map(|u| u.username.as_str())
            .unwrap_or("");
        csv.push_str(&format!(
            "{},{},{:?},{},{},{},{},{}\n",
            event.id,
            event.created_at.to_rfc3339(),
            event.event_type,
            csv_escape(&event.action),
            csv_escape(actor),
            event.resource_type.as_deref().unwrap_or(""),
            event.resource_id.as_deref().unwrap_or(""),
            event.ip_address.as_deref().unwrap_or(""),
        ));
    }

    Ok((
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, "text/csv; charset=utf-8".to_string()),
            (
                header::CONTENT_DISPOSITION,
                format!("attachment; filename=\"{}-audit.csv\"", org_slug),
            ),
        ],
        csv,
    )
        .into_response())
}

fn csv_escape(value: &str) -> String {
    if value.contains([',', '"', '\n']) {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

async fn enrich_audit_events(
    pool: &PgPool,
    rows: Vec<AuditEvent>,
) -> Result<Vec<AuditEventResponse>, ApiError> {
    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        let actor = if let Some(user_id) = row.actor_user_id {
            sqlx::query_as::<_, UserPublic>(
                r#"
                SELECT id, username, email, display_name, created_at
                FROM users WHERE id = $1
                "#,
            )
            .bind(user_id)
            .fetch_optional(pool)
            .await
            .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?
        } else {
            None
        };

        out.push(AuditEventResponse {
            id: row.id,
            organization_id: row.organization_id,
            actor,
            event_type: row.event_type,
            action: row.action,
            resource_type: row.resource_type,
            resource_id: row.resource_id,
            metadata: row.metadata,
            ip_address: row.ip_address,
            user_agent: row.user_agent,
            created_at: row.created_at,
        });
    }
    Ok(out)
}
