mod providers;

use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{delete, get, post},
    Json, Router,
};
use pertisk_domain::{models::*, org_groups::{ensure_org_chain, import_target_org_path}, DomainError};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use validator::Validate;

use crate::{
    audit::{self, AuditEventInput},
    find_org_for_member,
    ApiError, AppState, AuthUser,
};

use providers::{
    list_remote_namespaces, list_remote_repos, normalize_base_url, slug_from_name, validate_token,
    NamespaceFilter, RemoteNamespace, RemoteRepo,
};

const DEFAULT_MAX_REPOS_PER_JOB: usize = 500;

const IMPORT_JOB_COLUMNS: &str = r#"
    id, organization_id, created_by, credential_id, provider, import_issues, import_pull_requests,
    import_wiki, on_conflict, status, error_message, started_at, finished_at, created_at, updated_at
"#;

fn max_repos_per_job() -> usize {
    std::env::var("IMPORT_MAX_REPOS_PER_JOB")
        .ok()
        .and_then(|s| s.parse().ok())
        .filter(|n| *n > 0)
        .unwrap_or(DEFAULT_MAX_REPOS_PER_JOB)
}

pub fn import_routes() -> Router<AppState> {
    Router::new()
        .route("/import/preview", post(preview_import))
        .route("/import/ensure-group", post(ensure_import_group))
        .route("/import/credentials", get(list_my_credentials))
        .route(
            "/organizations/{org_path}/import/credentials",
            get(list_credentials).post(save_credential),
        )
        .route(
            "/organizations/{org_path}/import/credentials/{credential_id}",
            delete(delete_credential),
        )
        .route("/organizations/{org_path}/import/discover", post(discover_repos))
        .route(
            "/organizations/{org_path}/import/jobs",
            get(list_import_jobs).post(create_import_job),
        )
        .route(
            "/organizations/{org_path}/import/jobs/{job_id}",
            get(get_import_job),
        )
}

#[derive(Debug, Deserialize, Validate)]
struct SaveCredentialRequest {
    pub provider: ImportProvider,
    #[validate(length(min = 1))]
    pub token: String,
    pub base_url: Option<String>,
    pub label: Option<String>,
}

#[derive(Debug, Serialize)]
struct CredentialResponse {
    pub id: Uuid,
    pub provider: ImportProvider,
    pub base_url: Option<String>,
    pub label: Option<String>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Deserialize)]
struct DiscoverRequest {
    pub credential_id: Option<Uuid>,
    pub provider: Option<ImportProvider>,
    pub token: Option<String>,
    pub base_url: Option<String>,
    /// Org login, GitLab group path, or user login for personal repos.
    pub namespace: Option<String>,
    /// `personal`, `organization`, or `group` — required when `namespace` is set.
    pub namespace_kind: Option<String>,
}

#[derive(Debug, Serialize)]
struct DiscoverResponse {
    pub account: String,
    pub namespaces: Vec<RemoteNamespace>,
    pub repos: Vec<RemoteRepo>,
    pub max_repos_per_job: usize,
}

#[derive(Debug, Deserialize, Validate)]
struct ImportRepoSelection {
    pub source_id: String,
    pub source_full_name: String,
    pub source_clone_url: String,
    pub target_slug: Option<String>,
    pub target_name: Option<String>,
    pub description: Option<String>,
    pub visibility: Option<RepoVisibility>,
    pub default_branch: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CreateImportJobRequest {
    pub credential_id: Uuid,
    pub repos: Vec<ImportRepoSelection>,
    #[serde(default)]
    pub import_issues: bool,
    #[serde(default)]
    pub import_pull_requests: bool,
    #[serde(default)]
    pub import_wiki: bool,
    #[serde(default)]
    pub on_conflict: ImportOnConflict,
}

#[derive(Debug, Serialize)]
struct ImportJobDetail {
    #[serde(flatten)]
    pub job: ImportJob,
    pub repos: Vec<ImportJobRepo>,
}

#[derive(Debug, Deserialize, Validate)]
struct PreviewImportRequest {
    pub provider: ImportProvider,
    #[validate(length(min = 1))]
    pub token: String,
    pub base_url: Option<String>,
}

#[derive(Debug, Serialize)]
struct PreviewImportResponse {
    pub account: String,
    pub namespaces: Vec<RemoteNamespace>,
}

#[derive(Debug, Deserialize, Validate)]
struct EnsureImportGroupRequest {
    #[validate(length(min = 1))]
    pub path: String,
}

async fn preview_import(
    State(_state): State<AppState>,
    _auth: AuthUser,
    Json(body): Json<PreviewImportRequest>,
) -> Result<Json<PreviewImportResponse>, ApiError> {
    body.validate()
        .map_err(|e| ApiError::from(DomainError::Validation(e.to_string())))?;

    let base_url = normalize_base_url(body.provider, body.base_url.as_deref());
    let token = providers::normalize_token(&body.token);
    let account = validate_token(body.provider, &token, &base_url)
        .await
        .map_err(|e| ApiError::from(DomainError::Validation(e.to_string())))?;

    let namespaces = list_remote_namespaces(body.provider, &token, &base_url, &account)
        .await
        .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    Ok(Json(PreviewImportResponse { account, namespaces }))
}

async fn ensure_import_group(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(body): Json<EnsureImportGroupRequest>,
) -> Result<(StatusCode, Json<Organization>), ApiError> {
    body.validate()
        .map_err(|e| ApiError::from(DomainError::Validation(e.to_string())))?;

    let path = body.path.trim().trim_matches('/');
    if path.is_empty() {
        return Err(DomainError::Validation("group path is required".into()).into());
    }

    let org_id = ensure_org_chain(&state.pool, path, auth.user_id)
        .await
        .map_err(ApiError::from)?;

    let org = sqlx::query_as::<_, Organization>(
        "SELECT id, slug, name, description, parent_id, full_path, created_at, updated_at FROM organizations WHERE id = $1",
    )
    .bind(org_id)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    Ok((StatusCode::OK, Json(org)))
}

async fn credential_rows_for_user(
    pool: &sqlx::PgPool,
    user_id: Uuid,
) -> Result<Vec<CredentialResponse>, ApiError> {
    let rows = sqlx::query_as::<_, ImportCredential>(
        r#"
        SELECT id, organization_id, user_id, provider, base_url, label, created_at, updated_at
        FROM import_credentials
        WHERE user_id = $1
        ORDER BY updated_at DESC
        "#,
    )
    .bind(user_id)
    .fetch_all(pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    Ok(rows
        .into_iter()
        .map(|row| CredentialResponse {
            id: row.id,
            provider: row.provider,
            base_url: row.base_url,
            label: row.label,
            created_at: row.created_at,
        })
        .collect())
}

async fn list_my_credentials(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<Vec<CredentialResponse>>, ApiError> {
    Ok(Json(credential_rows_for_user(&state.pool, auth.user_id).await?))
}

async fn list_credentials(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(org_path): Path<String>,
) -> Result<Json<Vec<CredentialResponse>>, ApiError> {
    let org = find_org_for_member(&state.pool, &crate::org::org_path_from_param(&org_path), auth.user_id).await?;
    crate::permissions::ensure_can_manage_org_settings(&state.pool, org.id, auth.user_id).await?;
    Ok(Json(credential_rows_for_user(&state.pool, auth.user_id).await?))
}

async fn save_credential(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(org_path): Path<String>,
    Json(body): Json<SaveCredentialRequest>,
) -> Result<(StatusCode, Json<CredentialResponse>), ApiError> {
    body.validate()
        .map_err(|e| ApiError::from(DomainError::Validation(e.to_string())))?;

    let org = find_org_for_member(&state.pool, &crate::org::org_path_from_param(&org_path), auth.user_id).await?;
    crate::permissions::ensure_can_manage_org_settings(&state.pool, org.id, auth.user_id).await?;

    let base_url = normalize_base_url(body.provider, body.base_url.as_deref());
    let token = providers::normalize_token(&body.token);
    let account = validate_token(body.provider, &token, &base_url)
        .await
        .map_err(|e| ApiError::from(DomainError::Validation(e.to_string())))?;

    let encrypted = state
        .secrets_crypto
        .encrypt(&token)
        .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    let label = body
        .label
        .filter(|s| !s.trim().is_empty())
        .or_else(|| Some(format!("{account} ({})", provider_label(body.provider))));

    let row = sqlx::query_as::<_, ImportCredential>(
        r#"
        INSERT INTO import_credentials (organization_id, user_id, provider, base_url, encrypted_token, label)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (user_id, provider, base_url)
        DO UPDATE SET
            organization_id = EXCLUDED.organization_id,
            encrypted_token = EXCLUDED.encrypted_token,
            label = EXCLUDED.label,
            updated_at = NOW()
        RETURNING id, organization_id, user_id, provider, base_url, label, created_at, updated_at
        "#,
    )
    .bind(org.id)
    .bind(auth.user_id)
    .bind(body.provider)
    .bind(&base_url)
    .bind(&encrypted)
    .bind(&label)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    Ok((
        StatusCode::CREATED,
        Json(CredentialResponse {
            id: row.id,
            provider: row.provider,
            base_url: row.base_url,
            label: row.label,
            created_at: row.created_at,
        }),
    ))
}

async fn delete_credential(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_path, credential_id)): Path<(String, Uuid)>,
) -> Result<StatusCode, ApiError> {
    let org = find_org_for_member(&state.pool, &crate::org::org_path_from_param(&org_path), auth.user_id).await?;
    crate::permissions::ensure_can_manage_org_settings(&state.pool, org.id, auth.user_id).await?;

    let result = sqlx::query(
        r#"
        DELETE FROM import_credentials
        WHERE id = $1 AND user_id = $2
        "#,
    )
    .bind(credential_id)
    .bind(auth.user_id)
    .execute(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    if result.rows_affected() == 0 {
        return Err(DomainError::NotFound.into());
    }

    Ok(StatusCode::NO_CONTENT)
}

async fn discover_repos(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(org_path): Path<String>,
    Json(body): Json<DiscoverRequest>,
) -> Result<Json<DiscoverResponse>, ApiError> {
    let org = find_org_for_member(&state.pool, &crate::org::org_path_from_param(&org_path), auth.user_id).await?;
    crate::permissions::ensure_can_manage_org_settings(&state.pool, org.id, auth.user_id).await?;

    let (provider, token, base_url) = resolve_credential(&state, org.id, auth.user_id, &body).await?;
    let account = validate_token(provider, &token, &base_url)
        .await
        .map_err(|e| ApiError::from(DomainError::Validation(e.to_string())))?;

    let namespaces = list_remote_namespaces(provider, &token, &base_url, &account)
        .await
        .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    let namespace_filter = match body.namespace.as_deref().filter(|s| !s.is_empty()) {
        Some(path) => {
            let kind = body
                .namespace_kind
                .as_deref()
                .filter(|s| !s.is_empty())
                .or_else(|| {
                    namespaces
                        .iter()
                        .find(|ns| ns.path == path)
                        .map(|ns| ns.kind.as_str())
                })
                .ok_or_else(|| {
                    DomainError::Validation(
                        "namespace_kind is required when filtering by namespace".into(),
                    )
                })?;
            Some(NamespaceFilter { path, kind })
        }
        None => None,
    };

    let repos = list_remote_repos(provider, &token, &base_url, namespace_filter)
        .await
        .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    let repos = annotate_existing_repos(&state.pool, &org.full_path, repos)
        .await
        .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    Ok(Json(DiscoverResponse {
        account,
        namespaces,
        repos,
        max_repos_per_job: max_repos_per_job(),
    }))
}

async fn create_import_job(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(org_path): Path<String>,
    Json(body): Json<CreateImportJobRequest>,
) -> Result<(StatusCode, Json<ImportJobDetail>), ApiError> {
    if body.repos.is_empty() {
        return Err(DomainError::Validation("select at least one repository".into()).into());
    }
    let max_repos = max_repos_per_job();
    if body.repos.len() > max_repos {
        return Err(DomainError::Validation(format!(
            "import at most {max_repos} repositories per job"
        ))
        .into());
    }

    let org = find_org_for_member(&state.pool, &crate::org::org_path_from_param(&org_path), auth.user_id).await?;
    crate::permissions::ensure_can_manage_org_settings(&state.pool, org.id, auth.user_id).await?;

    let credential = sqlx::query_as::<_, (ImportProvider, Vec<u8>, Option<String>)>(
        r#"
        SELECT provider, encrypted_token, base_url
        FROM import_credentials
        WHERE id = $1 AND user_id = $2
        "#,
    )
    .bind(body.credential_id)
    .bind(auth.user_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?
    .ok_or(DomainError::NotFound)?;

    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    let job = sqlx::query_as::<_, ImportJob>(&format!(
        r#"
        INSERT INTO import_jobs (
            organization_id, created_by, credential_id, provider, import_issues, import_pull_requests,
            import_wiki, on_conflict, status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
        RETURNING {IMPORT_JOB_COLUMNS}
        "#
    ))
    .bind(org.id)
    .bind(auth.user_id)
    .bind(body.credential_id)
    .bind(credential.0)
    .bind(body.import_issues)
    .bind(body.import_pull_requests)
    .bind(body.import_wiki)
    .bind(body.on_conflict)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    let mut repos = Vec::with_capacity(body.repos.len());
    for selection in &body.repos {
        let target_name = selection
            .target_name
            .clone()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| {
                selection
                    .source_full_name
                    .rsplit('/')
                    .next()
                    .unwrap_or(&selection.source_full_name)
                    .to_string()
            });
        let target_slug = selection
            .target_slug
            .clone()
            .filter(|s| !s.trim().is_empty())
            .map(|s| slug_from_name(&s))
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| slug_from_name(&target_name));

        if target_slug.is_empty() {
            return Err(DomainError::Validation(format!(
                "invalid target slug for {}",
                selection.source_full_name
            ))
            .into());
        }

        let repo = sqlx::query_as::<_, ImportJobRepo>(
            r#"
            INSERT INTO import_job_repos (
                job_id, source_id, source_full_name, source_clone_url,
                target_slug, target_name, description, visibility, default_branch, status
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending')
            RETURNING
                id, job_id, source_id, source_full_name, source_clone_url,
                target_slug, target_name, description, visibility, default_branch,
                repository_id, status, error_message, created_at, updated_at
            "#,
        )
        .bind(job.id)
        .bind(&selection.source_id)
        .bind(&selection.source_full_name)
        .bind(&selection.source_clone_url)
        .bind(&target_slug)
        .bind(&target_name)
        .bind(&selection.description)
        .bind(selection.visibility.unwrap_or(RepoVisibility::Private))
        .bind(&selection.default_branch)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| match e {
            sqlx::Error::Database(db) if db.constraint().is_some() => ApiError::from(
                DomainError::Conflict("duplicate repository in import job".into()),
            ),
            other => ApiError::from(DomainError::Internal(other.to_string())),
        })?;
        repos.push(repo);
    }

    tx.commit()
        .await
        .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    let repo_names: Vec<_> = repos.iter().map(|r| r.source_full_name.clone()).collect();
    let _ = audit::record_audit_event(
        &state.pool,
        AuditEventInput {
            organization_id: Some(org.id),
            actor_user_id: Some(auth.user_id),
            event_type: AuditEventType::Import,
            action: format!("started import job with {} repositories", repos.len()),
            resource_type: Some("import_job".into()),
            resource_id: Some(job.id.to_string()),
            metadata: Some(serde_json::json!({
                "provider": job.provider,
                "repos": repo_names,
            })),
            ip_address: None,
            user_agent: None,
        },
    )
    .await;

    Ok((
        StatusCode::CREATED,
        Json(ImportJobDetail { job, repos }),
    ))
}

async fn list_import_jobs(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(org_path): Path<String>,
) -> Result<Json<Vec<ImportJob>>, ApiError> {
    let org = find_org_for_member(&state.pool, &crate::org::org_path_from_param(&org_path), auth.user_id).await?;
    crate::permissions::ensure_can_manage_org_settings(&state.pool, org.id, auth.user_id).await?;

    let jobs = sqlx::query_as::<_, ImportJob>(&format!(
        r#"
        SELECT {IMPORT_JOB_COLUMNS}
        FROM import_jobs
        WHERE organization_id = $1
        ORDER BY created_at DESC
        LIMIT 50
        "#
    ))
    .bind(org.id)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    Ok(Json(jobs))
}

async fn get_import_job(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_path, job_id)): Path<(String, Uuid)>,
) -> Result<Json<ImportJobDetail>, ApiError> {
    let org = find_org_for_member(&state.pool, &crate::org::org_path_from_param(&org_path), auth.user_id).await?;
    crate::permissions::ensure_can_manage_org_settings(&state.pool, org.id, auth.user_id).await?;

    let job = sqlx::query_as::<_, ImportJob>(&format!(
        r#"
        SELECT {IMPORT_JOB_COLUMNS}
        FROM import_jobs
        WHERE id = $1 AND organization_id = $2
        "#
    ))
    .bind(job_id)
    .bind(org.id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?
    .ok_or(DomainError::NotFound)?;

    let repos = sqlx::query_as::<_, ImportJobRepo>(
        r#"
        SELECT
            id, job_id, source_id, source_full_name, source_clone_url,
            target_slug, target_name, description, visibility, default_branch,
            repository_id, status, error_message, created_at, updated_at
        FROM import_job_repos
        WHERE job_id = $1
        ORDER BY source_full_name
        "#,
    )
    .bind(job_id)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    Ok(Json(ImportJobDetail { job, repos }))
}

async fn resolve_credential(
    state: &AppState,
    org_id: Uuid,
    user_id: Uuid,
    body: &DiscoverRequest,
) -> Result<(ImportProvider, String, String), ApiError> {
    if let Some(credential_id) = body.credential_id {
        let row = sqlx::query_as::<_, (ImportProvider, Vec<u8>, Option<String>)>(
            r#"
            SELECT provider, encrypted_token, base_url
            FROM import_credentials
            WHERE id = $1 AND user_id = $2
            "#,
        )
        .bind(credential_id)
        .bind(user_id)
        .fetch_optional(&state.pool)
        .await
        .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?
        .ok_or(DomainError::NotFound)?;

        let token = state
            .secrets_crypto
            .decrypt(&row.1)
            .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;
        let token = providers::normalize_token(&token);
        let base_url = normalize_base_url(row.0, row.2.as_deref());
        return Ok((row.0, token, base_url));
    }

    let provider = body
        .provider
        .ok_or(DomainError::Validation("provider or credential_id required".into()))?;
    let token = body
        .token
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .ok_or(DomainError::Validation("token required when credential_id is omitted".into()))?;
    let base_url = normalize_base_url(provider, body.base_url.as_deref());
    Ok((provider, token.to_string(), base_url))
}

fn provider_label(provider: ImportProvider) -> &'static str {
    match provider {
        ImportProvider::Github => "GitHub",
        ImportProvider::Gitlab => "GitLab",
        ImportProvider::Pertisk => "Pertisk Gits",
    }
}

async fn annotate_existing_repos(
    pool: &sqlx::PgPool,
    target_org_full_path: &str,
    repos: Vec<RemoteRepo>,
) -> Result<Vec<RemoteRepo>, sqlx::Error> {
    let mut annotated = Vec::with_capacity(repos.len());
    for mut repo in repos {
        let target_org = import_target_org_path(target_org_full_path, &repo.full_name);
        let target_slug = slug_from_name(&repo.name);
        let existing_path = format!("{target_org}/{target_slug}");

        let exists = sqlx::query_scalar::<_, Uuid>(
            r#"
            SELECT r.id
            FROM repositories r
            INNER JOIN organizations o ON o.id = r.organization_id
            WHERE o.full_path = $1 AND r.slug = $2
            "#,
        )
        .bind(&target_org)
        .bind(&target_slug)
        .fetch_optional(pool)
        .await?
        .is_some();

        repo.already_exists = exists;
        repo.existing_path = exists.then_some(existing_path);
        annotated.push(repo);
    }
    Ok(annotated)
}

/// Polls `import_jobs` inside pertisk-api so imports work without a separate worker service.
pub fn spawn_background_processor(pool: sqlx::PgPool, repos_root: std::path::PathBuf) {
    tokio::spawn(async move {
        use std::sync::Arc;
        use std::time::Duration;

        let repos_root = Arc::new(repos_root);
        let poll_secs = std::env::var("WORKER_POLL_SECS")
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(2);

        let worker = loop {
            match pertisk_worker::import::ImportWorker::from_env(pool.clone(), repos_root.clone()) {
                Ok(worker) => break worker,
                Err(err) => {
                    tracing::warn!(
                        "import processor waiting for JWT_SECRET or SECRETS_ENCRYPTION_KEY: {err:#}"
                    );
                    tokio::time::sleep(Duration::from_secs(30)).await;
                }
            }
        };

        tracing::info!("import background processor started");

        loop {
            match worker.process_pending_jobs().await {
                Ok(count) if count > 0 => tracing::info!(processed = count, "import jobs processed"),
                Ok(_) => {}
                Err(err) => {
                    let message = format!("{err:#}");
                    if message.contains("cached plan must not change result type") {
                        tracing::warn!(
                            "import processing failed: {message} \
                             (restart pertisk-gits after a database restore)"
                        );
                    } else {
                        tracing::warn!("import processing failed: {message}");
                    }
                }
            }
            tokio::time::sleep(Duration::from_secs(poll_secs)).await;
        }
    });
}
