use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{delete, get, patch, post},
    Json, Router,
};
use pertisk_domain::{models::*, DomainError};
use pertisk_git::RefUpdate;
use serde::Serialize;
use sqlx::PgPool;
use uuid::Uuid;
use validator::Validate;

use crate::{
    find_org_for_member, permissions, ApiError, AppState, AuthUser,
};

pub fn gitops_routes() -> Router<AppState> {
    Router::new()
        .route(
            "/organizations/{org_slug}/gitops-webhooks",
            get(list_org_gitops_webhooks).post(create_org_gitops_webhook),
        )
        .route(
            "/organizations/{org_slug}/gitops-webhooks/{webhook_id}",
            patch(update_org_gitops_webhook).delete(delete_org_gitops_webhook),
        )
        .route(
            "/organizations/{org_slug}/repositories/{repo_slug}/gitops-webhooks",
            get(list_repo_gitops_webhooks).post(create_repo_gitops_webhook),
        )
        .route(
            "/organizations/{org_slug}/repositories/{repo_slug}/gitops-webhooks/{webhook_id}",
            patch(update_repo_gitops_webhook).delete(delete_repo_gitops_webhook),
        )
}

#[derive(Serialize)]
struct GitOpsWebhookResponse {
    id: Uuid,
    organization_id: Uuid,
    repository_id: Option<Uuid>,
    name: String,
    url: String,
    provider: String,
    events: Vec<String>,
    enabled: bool,
    created_at: chrono::DateTime<chrono::Utc>,
    updated_at: chrono::DateTime<chrono::Utc>,
}

pub async fn dispatch_gitops_webhooks(
    pool: &PgPool,
    repository_id: Uuid,
    updates: &[RefUpdate],
) -> anyhow::Result<()> {
    let repo = sqlx::query_as::<_, (Uuid, String, String)>(
        r#"
        SELECT r.organization_id, o.slug, r.slug
        FROM repositories r
        INNER JOIN organizations o ON o.id = r.organization_id
        WHERE r.id = $1
        "#,
    )
    .bind(repository_id)
    .fetch_optional(pool)
    .await?;

    let Some((org_id, org_slug, repo_slug)) = repo else {
        return Ok(());
    };

    let webhooks = sqlx::query_as::<_, GitOpsWebhook>(
        r#"
        SELECT id, organization_id, repository_id, name, url, provider, secret, events, enabled,
               created_by, created_at, updated_at
        FROM gitops_webhooks
        WHERE enabled = TRUE
          AND organization_id = $1
          AND (repository_id IS NULL OR repository_id = $2)
        "#,
    )
    .bind(org_id)
    .bind(repository_id)
    .fetch_all(pool)
    .await?;

    if webhooks.is_empty() {
        return Ok(());
    }

    let client = reqwest::Client::new();
    for update in updates {
        let old_oid = update.old_sha.as_deref().unwrap_or("0000000000000000000000000000000000000000");
        if old_oid == update.new_sha {
            continue;
        }
        let event = if update.new_sha.chars().all(|c| c == '0') {
            "delete"
        } else {
            "push"
        };

        for webhook in &webhooks {
            if !webhook.events.iter().any(|e| e == event || e == "push") {
                continue;
            }

            let payload = serde_json::json!({
                "event": event,
                "provider": webhook.provider,
                "organization": org_slug,
                "repository": repo_slug,
                "ref": update.ref_name,
                "old_oid": old_oid,
                "new_oid": update.new_sha,
            });

            let mut request = client.post(&webhook.url).json(&payload);
            if let Some(secret) = &webhook.secret {
                request = request.header("X-Pertisk-Gitops-Secret", secret);
            }
            if webhook.provider == "argocd" {
                request = request.header("X-ArgoCD-Webhook", "push");
            }

            if let Err(err) = request.send().await {
                tracing::warn!(
                    webhook = %webhook.name,
                    repo = %repo_slug,
                    "gitops webhook delivery failed: {err:#}"
                );
            }
        }
    }

    Ok(())
}

async fn list_org_gitops_webhooks(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(org_slug): Path<String>,
) -> Result<Json<Vec<GitOpsWebhookResponse>>, ApiError> {
    let org = find_org_for_member(&state.pool, &org_slug, auth.user_id).await?;
    permissions::ensure_can_manage_org_settings(&state.pool, org.id, auth.user_id).await?;

    let rows = sqlx::query_as::<_, GitOpsWebhook>(
        r#"
        SELECT id, organization_id, repository_id, name, url, provider, secret, events, enabled,
               created_by, created_at, updated_at
        FROM gitops_webhooks
        WHERE organization_id = $1 AND repository_id IS NULL
        ORDER BY name
        "#,
    )
    .bind(org.id)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    Ok(Json(rows.into_iter().map(GitOpsWebhookResponse::from).collect()))
}

async fn create_org_gitops_webhook(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(org_slug): Path<String>,
    Json(body): Json<CreateGitOpsWebhookRequest>,
) -> Result<(StatusCode, Json<GitOpsWebhookResponse>), ApiError> {
    let org = find_org_for_member(&state.pool, &org_slug, auth.user_id).await?;
    permissions::ensure_can_manage_org_settings(&state.pool, org.id, auth.user_id).await?;
    insert_webhook(&state.pool, org.id, None, auth.user_id, body).await
}

async fn list_repo_gitops_webhooks(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_slug, repo_slug)): Path<(String, String)>,
) -> Result<Json<Vec<GitOpsWebhookResponse>>, ApiError> {
    let org = find_org_for_member(&state.pool, &org_slug, auth.user_id).await?;
    let repo = permissions::find_repo_in_org(&state.pool, org.id, &repo_slug).await?;
    permissions::ensure_can_admin_repo(&state.pool, org.id, &repo, &auth).await?;

    let rows = sqlx::query_as::<_, GitOpsWebhook>(
        r#"
        SELECT id, organization_id, repository_id, name, url, provider, secret, events, enabled,
               created_by, created_at, updated_at
        FROM gitops_webhooks
        WHERE organization_id = $1 AND repository_id = $2
        ORDER BY name
        "#,
    )
    .bind(org.id)
    .bind(repo.id)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    Ok(Json(rows.into_iter().map(GitOpsWebhookResponse::from).collect()))
}

async fn create_repo_gitops_webhook(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_slug, repo_slug)): Path<(String, String)>,
    Json(body): Json<CreateGitOpsWebhookRequest>,
) -> Result<(StatusCode, Json<GitOpsWebhookResponse>), ApiError> {
    let org = find_org_for_member(&state.pool, &org_slug, auth.user_id).await?;
    let repo = permissions::find_repo_in_org(&state.pool, org.id, &repo_slug).await?;
    permissions::ensure_can_admin_repo(&state.pool, org.id, &repo, &auth).await?;
    insert_webhook(&state.pool, org.id, Some(repo.id), auth.user_id, body).await
}

async fn update_org_gitops_webhook(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_slug, webhook_id)): Path<(String, Uuid)>,
    Json(body): Json<UpdateGitOpsWebhookRequest>,
) -> Result<Json<GitOpsWebhookResponse>, ApiError> {
    let org = find_org_for_member(&state.pool, &org_slug, auth.user_id).await?;
    permissions::ensure_can_manage_org_settings(&state.pool, org.id, auth.user_id).await?;
    update_webhook(&state.pool, org.id, None, webhook_id, body).await
}

async fn delete_org_gitops_webhook(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_slug, webhook_id)): Path<(String, Uuid)>,
) -> Result<StatusCode, ApiError> {
    let org = find_org_for_member(&state.pool, &org_slug, auth.user_id).await?;
    permissions::ensure_can_manage_org_settings(&state.pool, org.id, auth.user_id).await?;
    delete_webhook(&state.pool, org.id, None, webhook_id).await
}

async fn update_repo_gitops_webhook(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_slug, repo_slug, webhook_id)): Path<(String, String, Uuid)>,
    Json(body): Json<UpdateGitOpsWebhookRequest>,
) -> Result<Json<GitOpsWebhookResponse>, ApiError> {
    let org = find_org_for_member(&state.pool, &org_slug, auth.user_id).await?;
    let repo = permissions::find_repo_in_org(&state.pool, org.id, &repo_slug).await?;
    permissions::ensure_can_admin_repo(&state.pool, org.id, &repo, &auth).await?;
    update_webhook(&state.pool, org.id, Some(repo.id), webhook_id, body).await
}

async fn delete_repo_gitops_webhook(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_slug, repo_slug, webhook_id)): Path<(String, String, Uuid)>,
) -> Result<StatusCode, ApiError> {
    let org = find_org_for_member(&state.pool, &org_slug, auth.user_id).await?;
    let repo = permissions::find_repo_in_org(&state.pool, org.id, &repo_slug).await?;
    permissions::ensure_can_admin_repo(&state.pool, org.id, &repo, &auth).await?;
    delete_webhook(&state.pool, org.id, Some(repo.id), webhook_id).await
}

async fn insert_webhook(
    pool: &PgPool,
    org_id: Uuid,
    repository_id: Option<Uuid>,
    created_by: Uuid,
    body: CreateGitOpsWebhookRequest,
) -> Result<(StatusCode, Json<GitOpsWebhookResponse>), ApiError> {
    body.validate()
        .map_err(|e| ApiError::from(DomainError::Validation(e.to_string())))?;

    let provider = body.provider.unwrap_or_else(|| "generic".into());
    let row = sqlx::query_as::<_, GitOpsWebhook>(
        r#"
        INSERT INTO gitops_webhooks (
            organization_id, repository_id, name, url, provider, secret, events, enabled, created_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id, organization_id, repository_id, name, url, provider, secret, events, enabled,
                  created_by, created_at, updated_at
        "#,
    )
    .bind(org_id)
    .bind(repository_id)
    .bind(body.name.trim())
    .bind(body.url.trim())
    .bind(provider)
    .bind(body.secret.as_deref().filter(|value| !value.is_empty()))
    .bind(&body.events)
    .bind(body.enabled)
    .bind(created_by)
    .fetch_one(pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    Ok((StatusCode::CREATED, Json(GitOpsWebhookResponse::from(row))))
}

async fn update_webhook(
    pool: &PgPool,
    org_id: Uuid,
    repository_id: Option<Uuid>,
    webhook_id: Uuid,
    body: UpdateGitOpsWebhookRequest,
) -> Result<Json<GitOpsWebhookResponse>, ApiError> {
    body.validate()
        .map_err(|e| ApiError::from(DomainError::Validation(e.to_string())))?;

    let existing = find_webhook(pool, org_id, repository_id, webhook_id).await?;
    let name = body.name.as_deref().unwrap_or(&existing.name).trim().to_string();
    let url = body.url.as_deref().unwrap_or(&existing.url).trim().to_string();
    let secret = match body.secret {
        Some(value) if value.trim().is_empty() => None,
        Some(value) => Some(value),
        None => existing.secret.clone(),
    };
    let events = body.events.unwrap_or(existing.events.clone());
    let enabled = body.enabled.unwrap_or(existing.enabled);

    let row = sqlx::query_as::<_, GitOpsWebhook>(
        r#"
        UPDATE gitops_webhooks
        SET name = $1, url = $2, secret = $3, events = $4, enabled = $5, updated_at = now()
        WHERE id = $6
        RETURNING id, organization_id, repository_id, name, url, provider, secret, events, enabled,
                  created_by, created_at, updated_at
        "#,
    )
    .bind(name)
    .bind(url)
    .bind(secret)
    .bind(events)
    .bind(enabled)
    .bind(webhook_id)
    .fetch_one(pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    Ok(Json(GitOpsWebhookResponse::from(row)))
}

async fn delete_webhook(
    pool: &PgPool,
    org_id: Uuid,
    repository_id: Option<Uuid>,
    webhook_id: Uuid,
) -> Result<StatusCode, ApiError> {
    let _ = find_webhook(pool, org_id, repository_id, webhook_id).await?;
    sqlx::query("DELETE FROM gitops_webhooks WHERE id = $1")
        .bind(webhook_id)
        .execute(pool)
        .await
        .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;
    Ok(StatusCode::NO_CONTENT)
}

async fn find_webhook(
    pool: &PgPool,
    org_id: Uuid,
    repository_id: Option<Uuid>,
    webhook_id: Uuid,
) -> Result<GitOpsWebhook, ApiError> {
    let row = sqlx::query_as::<_, GitOpsWebhook>(
        r#"
        SELECT id, organization_id, repository_id, name, url, provider, secret, events, enabled,
               created_by, created_at, updated_at
        FROM gitops_webhooks
        WHERE id = $1 AND organization_id = $2
          AND (($3::uuid IS NULL AND repository_id IS NULL) OR repository_id = $3)
        "#,
    )
    .bind(webhook_id)
    .bind(org_id)
    .bind(repository_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?
    .ok_or(DomainError::NotFound)?;

    Ok(row)
}

impl From<GitOpsWebhook> for GitOpsWebhookResponse {
    fn from(row: GitOpsWebhook) -> Self {
        Self {
            id: row.id,
            organization_id: row.organization_id,
            repository_id: row.repository_id,
            name: row.name,
            url: row.url,
            provider: row.provider,
            events: row.events,
            enabled: row.enabled,
            created_at: row.created_at,
            updated_at: row.updated_at,
        }
    }
}
