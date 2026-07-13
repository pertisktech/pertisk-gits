use std::net::SocketAddr;
use std::sync::Arc;

use axum::{
    extract::{ConnectInfo, DefaultBodyLimit, Path, Query, State},
    http::{header, Method, Request, StatusCode},
    middleware::{from_fn_with_state, Next},
    response::{Html, IntoResponse, Response},
    routing::{get, get_service, patch, post},
    Json, Router,
};
use pertisk_domain::{
    auth::{create_token, verify_token},
    models::*,
    org_path::{join_org_path, normalize_org_path},
    DomainError,
};
use pertisk_git::{
    access::{self, AuthUser as GitAuthUser, RepoRecord},
    config::repo_disk_path,
    explorer::{self, BlameLine, BranchInfo, CommitDetail, CommitInfo, RefKind, RepoBrowser, TagInfo, TreeEntry},
    http::GitHttpState,
    ssh::{GitSshConfig, GitSshState},
    storage::{ensure_bare_repo, init_bare_repo, repo_exists_on_disk},
    ssh_keys,
};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::{ServeDir, ServeFile};
use tower_http::trace::TraceLayer;
use uuid::Uuid;
use validator::Validate;

mod admin;
mod api_tokens;
mod artifacts;
mod audit;
mod backup;
mod branch_protection;
mod branches;
mod ci_secrets;
mod collaboration;
mod compression;
mod contents;
mod custom_roles;
mod dashboard;
mod cicd;
mod code_search;
mod config;
mod deploy_keys;
mod db;
mod gitops;
mod import;
mod email_templates;
mod notifications;
mod request_context;
mod user_agent;
mod observability;
mod org;
mod password;
mod permissions;
mod push_hints;
pub(crate) use org::find_org_for_member;

mod registry;
mod repository_activity;
mod secrets_crypto;
mod sso;
mod system_metrics;
mod tags;
mod teams;
mod version;
mod wiki;

pub use config::Config;
pub use version::{display_version, init_display_version, APP_VERSION, RUSTC_VERSION};

use chrono::Utc;
use password::{hash_password, verify_password};
use secrets_crypto::SecretsCrypto;

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub config: Arc<Config>,
    pub artifacts: artifacts::ArtifactStore,
    pub secrets_crypto: Arc<SecretsCrypto>,
    pub started_at: chrono::DateTime<Utc>,
}

#[derive(Serialize)]
struct ErrorBody {
    error: String,
}

#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
    version: &'static str,
    database: &'static str,
    /// Public API base URL for runners (`PERTISK_API_URL`); from `GIT_PUBLIC_BASE_URL`.
    api_url: String,
}

#[derive(Serialize)]
struct MeResponse {
    user: UserPublic,
    is_super_admin: bool,
    has_password: bool,
}

#[derive(Serialize)]
struct RepositoryResponse {
    repository: Repository,
    clone_url_http: String,
    clone_url_ssh: Option<String>,
}

/// Start the HTTP API server (also used by the `pertisk-api` binary).
pub async fn run() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();

    observability::init_tracing_subscriber();

    let config = Arc::new(Config::from_env()?);
    version::init_display_version(config.web_dist.as_deref());
    tracing::info!(version = %version::display_version(), "pertisk-api starting");
    std::fs::create_dir_all(&config.repos_root)?;
    std::fs::create_dir_all(&config.search_index_root)?;
    let pool = db::connect(&config.database_url).await?;
    sqlx::migrate!("../../migrations").run(&pool).await?;
    observability::init_from_db(&pool)
        .await
        .map_err(|e| anyhow::anyhow!(e.0.to_string()))?;
    cicd::spawn_runner_stale_checker(pool.clone());
    import::spawn_background_processor(pool.clone(), config.repos_root.clone());
    code_search::spawn_background_processor(
        pool.clone(),
        config.repos_root.clone(),
        Arc::new(config.search_index_root.clone()),
    );
    let artifact_store = artifacts::ArtifactStore::from_env()?;
    let secrets_crypto = Arc::new(SecretsCrypto::from_env()?);
    notifications::init_notification_context(notifications::NotificationContext {
        secrets_crypto: secrets_crypto.clone(),
        base_url: config.git_public_base_url.clone(),
    });

    let state = AppState {
        pool,
        config: config.clone(),
        artifacts: artifact_store,
        secrets_crypto,
        started_at: Utc::now(),
    };

    let repo_read_routes = Router::new()
        .route(
            "/organizations/{org_path}/repositories/{repo_slug}",
            get(get_repository),
        )
        .route(
            "/organizations/{org_path}/repositories/{repo_slug}/browser",
            get(get_repo_browser),
        )
        .route(
            "/organizations/{org_path}/repositories/{repo_slug}/tree",
            get(get_repo_tree),
        )
        .route(
            "/organizations/{org_path}/repositories/{repo_slug}/blob",
            get(get_repo_blob),
        )
        .route(
            "/organizations/{org_path}/repositories/{repo_slug}/blame",
            get(get_repo_blame),
        )
        .route(
            "/organizations/{org_path}/repositories/{repo_slug}/raw",
            get(get_repo_raw),
        )
        .route(
            "/organizations/{org_path}/repositories/{repo_slug}/archive",
            get(get_repo_archive),
        )
        .route(
            "/organizations/{org_path}/repositories/{repo_slug}/tags",
            get(get_repo_tags),
        )
        .route(
            "/organizations/{org_path}/repositories/{repo_slug}/branches",
            get(get_repo_branches),
        )
        .route(
            "/organizations/{org_path}/repositories/{repo_slug}/commits",
            get(get_repo_commits),
        )
        .route(
            "/organizations/{org_path}/repositories/{repo_slug}/commits/{commit_sha}",
            get(get_repo_commit),
        )
        .merge(collaboration::collaboration_read_routes())
        .merge(wiki::wiki_read_routes())
        .merge(code_search::code_search_read_routes())
        .merge(cicd::cicd_read_routes())
        .merge(ci_secrets::ci_secrets_read_routes())
        .merge(registry::registry_read_routes())
        .layer(from_fn_with_state(state.clone(), optional_auth_middleware));

    let protected_routes = Router::new()
        .route("/health", get(health))
        .route("/auth/register", post(register))
        .route("/auth/login", post(login))
        .route("/auth/registration", get(registration_info))
        .merge(sso::sso_routes())
        .route("/me", get(me).patch(update_me))
        .route("/users/search", get(search_users))
        .merge(dashboard::dashboard_routes())
        .route("/me/ssh-keys", get(list_ssh_keys).post(create_ssh_key))
        .route("/me/ssh-keys/{key_id}", axum::routing::delete(delete_ssh_key))
        .route("/organizations", get(list_organizations).post(create_organization))
        .route(
            "/organizations/{org_path}",
            patch(update_organization).delete(delete_organization),
        )
        .route("/organizations/{org_path}/subgroups", get(list_organization_subgroups))
        .route("/organizations/{org_path}/members", get(list_organization_members))
        .route(
            "/organizations/{org_path}/repositories",
            get(list_repositories).post(create_repository),
        )
        .route(
            "/organizations/{org_path}/repositories/{repo_slug}",
            patch(update_repository)
                .delete(delete_repository),
        )
        .route(
            "/organizations/{org_path}/repositories/{repo_slug}/transfer",
            post(transfer_repository),
        )
        .merge(permissions::permissions_routes())
        .merge(custom_roles::custom_role_routes())
        .merge(teams::team_routes())
        .merge(collaboration::collaboration_write_routes())
        .merge(wiki::wiki_write_routes())
        .merge(deploy_keys::deploy_key_routes())
        .merge(contents::contents_routes())
        .merge(tags::tags_write_routes())
        .merge(branches::branches_write_routes())
        .merge(api_tokens::api_token_routes())
        .merge(gitops::gitops_routes())
        .merge(cicd::cicd_write_routes())
        .merge(ci_secrets::ci_secrets_write_routes())
        .merge(registry::registry_write_routes())
        .merge(audit::audit_routes())
        .merge(import::import_routes())
        .merge(admin::admin_routes())
        .merge(observability::observability_routes())
        .merge(notifications::notification_routes())
        .merge(backup::backup_routes())
        .merge(branch_protection::branch_protection_read_routes())
        .merge(branch_protection::branch_protection_write_routes())
        .layer(from_fn_with_state(state.clone(), auth_middleware));

    let api_routes = Router::new()
        .merge(repo_read_routes)
        .merge(protected_routes)
        .merge(cicd::runner_routes())
        .merge(cicd::runner_autoscale_routes());

    let push_pool = state.pool.clone();
    let validate_push: pertisk_git::http::ValidatePushHook = Arc::new(
        move |repo_id, user_id, repo_path, updates| {
            let pool = push_pool.clone();
            Box::pin(async move {
                branch_protection::validate_push_updates(&pool, repo_id, user_id, &repo_path, &updates)
                    .await
            })
        },
    );

    let push_hints_pool = state.pool.clone();
    let push_hints_base_url = state.config.git_public_base_url.clone();
    let push_hints: pertisk_git::http::PushHintHook = Arc::new(move |repo_id, updates| {
        let pool = push_hints_pool.clone();
        let base_url = push_hints_base_url.clone();
        Box::pin(async move {
            let row = sqlx::query_as::<_, (String, String)>(
                r#"
                SELECT o.full_path, r.slug
                FROM repositories r
                JOIN organizations o ON o.id = r.organization_id
                WHERE r.id = $1
                "#,
            )
            .bind(repo_id)
            .fetch_optional(&pool)
            .await;

            let Ok(Some((org_path, repo_slug))) = row else {
                return Vec::new();
            };

            push_hints::build_merge_request_push_hints(
                &pool,
                &base_url,
                repo_id,
                &org_path,
                &repo_slug,
                &updates,
            )
            .await
            .unwrap_or_default()
        })
    });

    let git_state = GitHttpState {
        pool: state.pool.clone(),
        repos_root: state.config.repos_root.clone(),
        post_receive: Some(cicd::post_receive_hook(state.clone())),
        validate_push: Some(validate_push),
        push_hints: Some(push_hints.clone()),
    };

    if let Some(ssh_port) = config.git_ssh_port {
        let ssh_state = Arc::new(GitSshState {
            pool: state.pool.clone(),
            repos_root: state.config.repos_root.clone(),
            config: GitSshConfig {
                host: std::env::var("GIT_SSH_HOST").unwrap_or_else(|_| "0.0.0.0".into()),
                port: ssh_port,
                host_key_path: config.git_ssh_host_key_path.clone(),
            },
            post_receive: Some(cicd::post_receive_hook(state.clone())),
            push_hints: Some(push_hints),
        });

        tokio::spawn(async move {
            if let Err(err) = pertisk_git::ssh::run_server(ssh_state).await {
                tracing::error!("git ssh server failed: {err:#}");
            }
        });
    }

    let git_state = Arc::new(git_state);

    let mut app = Router::new()
        .route("/health", get(health))
        .route("/health/live", get(health_live))
        .nest("/api/v1", api_routes);

    if std::env::var("REGISTRY_EMBEDDED").unwrap_or_else(|_| "1".into()) != "0" {
        let registry_config = pertisk_registry::config::RegistryConfig::from_env()?;
        let registry_state =
            pertisk_registry::build_state(&registry_config, state.pool.clone()).await?;
        app = app.merge(pertisk_registry::router().with_state(registry_state));
        tracing::info!("embedded OCI registry routes at /v2 and /service/token");
    }

    if let Some(web_dist) = &config.web_dist {
        let index = web_dist.join("index.html");
        if !index.is_file() {
            anyhow::bail!(
                "WEB_DIST={} but index.html is missing — run `cd web && npm run build` first",
                web_dist.display()
            );
        }
        app = app
            .nest_service(
                "/assets",
                ServeDir::new(web_dist.join("assets"))
                    .precompressed_zstd()
                    .precompressed_br()
                    .precompressed_gzip(),
            )
            .route_service("/favicon.svg", get_service(ServeFile::new(web_dist.join("favicon.svg"))))
            .route_service("/favicon.png", get_service(ServeFile::new(web_dist.join("favicon.png"))))
            .route_service("/logo.png", get_service(ServeFile::new(web_dist.join("logo.png"))))
            .route_service("/logo-192.png", get_service(ServeFile::new(web_dist.join("logo-192.png"))))
            .route_service("/icons.svg", get_service(ServeFile::new(web_dist.join("icons.svg"))));

        let themes_dir = web_dist.join("themes");
        if themes_dir.is_dir() {
            app = app.nest_service(
                "/themes",
                ServeDir::new(themes_dir)
                    .precompressed_zstd()
                    .precompressed_br()
                    .precompressed_gzip(),
            );
        }

        app = app.fallback(get(spa_index));
        tracing::info!("serving web UI from {}", web_dist.display());
    } else {
        app = app.route("/", get(root));
    }

    let mut app = app
        .layer(DefaultBodyLimit::max(pertisk_registry::MAX_REGISTRY_BODY_BYTES))
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods(Any)
                .allow_headers(Any),
        )
        .layer(axum::middleware::from_fn(observability::http_observability_middleware))
        .layer(TraceLayer::new_for_http());

    if compression::http_compression_enabled() {
        app = app.layer(compression::compression_layer());
        tracing::info!("HTTP response compression enabled (preference: zstd > br > gzip)");
    }

    // Git smart HTTP paths (`/{org}/{repo}.git/info/refs`, etc.) must be handled before the
    // SPA fallback; when the layer only wrapped `/health` + `/api/v1`, clone URLs returned
    // `index.html` and git reported "not valid: is this a git repository?".
    app = app.layer(from_fn_with_state(git_state, git_smart_http_middleware));

    let app = app.with_state(state.clone());

    let addr = format!("{}:{}", config.host, config.port);
    tracing::info!("pertisk-api listening on {addr}");

    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await?;

    Ok(())
}

async fn root() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "service": "pertisk-api",
        "version": version::display_version(),
        "note": "This is the REST API. Open the web UI at http://localhost:5173",
        "health": "/health",
        "health_live": "/health/live",
        "api_health": "/api/v1/health",
        "api_base": "/api/v1"
    }))
}

async fn git_smart_http_middleware(
    State(git): State<Arc<GitHttpState>>,
    req: Request<axum::body::Body>,
    next: Next,
) -> Response {
    if !pertisk_git::http::is_smart_http_path(req.uri().path()) {
        return next.run(req).await;
    }
    pertisk_git::http::handle(State((*git).clone()), req).await
}

async fn spa_index(method: Method, State(state): State<AppState>) -> Result<Response, StatusCode> {
    if method != Method::GET && method != Method::HEAD {
        return Err(StatusCode::NOT_FOUND);
    }

    let web_dist = state
        .config
        .web_dist
        .as_ref()
        .ok_or(StatusCode::NOT_FOUND)?;

    let mut response = if method == Method::HEAD {
        StatusCode::OK.into_response()
    } else {
        let content = tokio::fs::read_to_string(web_dist.join("index.html"))
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        Html(content).into_response()
    };

    let headers = response.headers_mut();
    headers.insert(
        header::CACHE_CONTROL,
        header::HeaderValue::from_static("no-cache, no-store, must-revalidate"),
    );

    Ok(response)
}

async fn health(State(state): State<AppState>) -> (StatusCode, Json<HealthResponse>) {
    let database = match sqlx::query("SELECT 1").execute(&state.pool).await {
        Ok(_) => "ok",
        Err(error) => {
            tracing::warn!(%error, "health check: database unavailable");
            "error"
        }
    };

    let healthy = database == "ok";
    let status_code = if healthy {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };

    (
        status_code,
        Json(HealthResponse {
            status: if healthy { "ok" } else { "unhealthy" },
            version: version::display_version(),
            database,
            api_url: state.config.git_public_base_url.clone(),
        }),
    )
}

async fn health_live() -> (StatusCode, &'static str) {
    (StatusCode::OK, "ok")
}

async fn registration_info() -> Json<RegistrationInfoResponse> {
    Json(RegistrationInfoResponse {
        enabled: admin::registration_enabled(),
        require_approval: admin::registration_requires_approval(),
    })
}

async fn register(
    State(state): State<AppState>,
    Json(body): Json<RegisterRequest>,
) -> Result<Json<RegisterResponse>, ApiError> {
    if !admin::registration_enabled() {
        return Err(DomainError::Forbidden.into());
    }

    body.validate()
        .map_err(|e| ApiError::from(DomainError::Validation(e.to_string())))?;

    let password_hash = hash_password(&body.password)
        .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    let requires_approval = admin::registration_requires_approval();
    let approval_status = if requires_approval {
        UserApprovalStatus::Pending
    } else {
        UserApprovalStatus::Approved
    };

    let user = sqlx::query_as::<_, User>(
        r#"
        INSERT INTO users (username, email, password_hash, display_name, approval_status, approved_at)
        VALUES ($1, $2, $3, $4, $5, CASE WHEN $5 = 'approved' THEN NOW() ELSE NULL END)
        RETURNING id, username, email, password_hash, display_name, is_super_admin, is_machine_user,
                  approval_status, approved_at, approved_by, created_at, updated_at
        "#,
    )
    .bind(&body.username)
    .bind(&body.email)
    .bind(&password_hash)
    .bind(&body.display_name)
    .bind(approval_status)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| match e {
        sqlx::Error::Database(db) if db.constraint().is_some() => {
            ApiError::from(DomainError::Conflict("username or email already exists".into()))
        }
        other => ApiError::from(DomainError::Internal(other.to_string())),
    })?;

    notifications::notify_user_registered(
        state.pool.clone(),
        state.secrets_crypto.clone(),
        state.config.git_public_base_url.clone(),
        user.id,
        requires_approval,
    );

    if requires_approval {
        return Ok(Json(RegisterResponse {
            user: user.into_public(),
            pending_approval: true,
            token: None,
            is_super_admin: None,
        }));
    }

    let token = create_token(user.id, &user.username, &state.config.jwt_secret, 72)
        .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    let is_super_admin = admin::is_super_admin(&state.pool, user.id).await?;

    Ok(Json(RegisterResponse {
        user: user.into_public(),
        pending_approval: false,
        token: Some(token),
        is_super_admin: Some(is_super_admin),
    }))
}

async fn login(
    State(state): State<AppState>,
    ConnectInfo(peer_addr): ConnectInfo<SocketAddr>,
    headers: axum::http::HeaderMap,
    Json(body): Json<LoginRequest>,
) -> Result<Json<AuthResponse>, ApiError> {
    body.validate()
        .map_err(|e| ApiError::from(DomainError::Validation(e.to_string())))?;

    let user = sqlx::query_as::<_, User>(
        r#"
        SELECT id, username, email, password_hash, display_name, is_super_admin, is_machine_user,
               approval_status, approved_at, approved_by, created_at, updated_at
        FROM users
        WHERE username = $1 OR email = $1
        "#,
    )
    .bind(&body.login)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?
    .ok_or(DomainError::Unauthorized)?;

    let valid = match &user.password_hash {
        Some(hash) => verify_password(&body.password, hash)
            .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?,
        None => false,
    };

    if !valid {
        return Err(DomainError::Unauthorized.into());
    }

    admin::ensure_user_record_approved(&user)?;

    let token = create_token(user.id, &user.username, &state.config.jwt_secret, 72)
        .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    audit::record_audit_event(
        &state.pool,
        audit::AuditEventInput {
            organization_id: None,
            actor_user_id: Some(user.id),
            event_type: pertisk_domain::models::AuditEventType::Login,
            action: "password login".into(),
            resource_type: Some("user".into()),
            resource_id: Some(user.id.to_string()),
            metadata: None,
            ip_address: None,
            user_agent: None,
        },
    )
    .await?;

    notifications::notify_login(
        state.pool.clone(),
        state.secrets_crypto.clone(),
        user.id,
        "password",
        request_context::LoginContext::from_parts(&headers, Some(peer_addr)),
    );

    let is_super_admin = admin::is_super_admin(&state.pool, user.id).await?;

    Ok(Json(AuthResponse {
        token,
        user: user.into_public(),
        is_super_admin,
    }))
}

async fn me(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<MeResponse>, ApiError> {
    let user = sqlx::query_as::<_, UserPublic>(
        r#"
        SELECT id, username, email, display_name, created_at
        FROM users
        WHERE id = $1
        "#,
    )
    .bind(auth.user_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?
    .ok_or(DomainError::NotFound)?;

    let has_password = sqlx::query_scalar::<_, bool>(
        "SELECT password_hash IS NOT NULL FROM users WHERE id = $1",
    )
    .bind(auth.user_id)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    Ok(Json(MeResponse {
        user,
        is_super_admin: admin::is_super_admin(&state.pool, auth.user_id).await?,
        has_password,
    }))
}

async fn update_me(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(body): Json<UpdateProfileRequest>,
) -> Result<Json<MeResponse>, ApiError> {
    body.validate()
        .map_err(|e| ApiError::from(DomainError::Validation(e.to_string())))?;

    if body.email.is_none()
        && body.display_name.is_none()
        && body.new_password.is_none()
    {
        return Err(DomainError::Validation("no fields to update".into()).into());
    }

    if body.new_password.is_some() && body.current_password.is_none() {
        return Err(DomainError::Validation(
            "current password is required to set a new password".into(),
        )
        .into());
    }

    let existing = sqlx::query_as::<_, User>(
        r#"
        SELECT id, username, email, password_hash, display_name, is_super_admin, is_machine_user,
               approval_status, approved_at, approved_by, created_at, updated_at
        FROM users
        WHERE id = $1
        "#,
    )
    .bind(auth.user_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?
    .ok_or(DomainError::NotFound)?;

    if existing.is_machine_user {
        return Err(DomainError::Forbidden.into());
    }

    let email = body
        .email
        .as_ref()
        .map(|value| value.trim().to_string())
        .unwrap_or(existing.email);

    let display_name = match &body.display_name {
        Some(value) => {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }
        None => existing.display_name,
    };

    let password_hash = if let Some(new_password) = &body.new_password {
        let current = body
            .current_password
            .as_deref()
            .ok_or(DomainError::Validation(
                "current password is required to set a new password".into(),
            ))?;
        let Some(hash) = &existing.password_hash else {
            return Err(DomainError::Validation(
                "password cannot be changed for SSO-only accounts".into(),
            )
            .into());
        };
        let valid = verify_password(current, hash)
            .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;
        if !valid {
            return Err(DomainError::Unauthorized.into());
        }
        Some(
            hash_password(new_password)
                .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?,
        )
    } else {
        existing.password_hash
    };

    let user = sqlx::query_as::<_, UserPublic>(
        r#"
        UPDATE users
        SET email = $1,
            display_name = $2,
            password_hash = $3,
            updated_at = NOW()
        WHERE id = $4
        RETURNING id, username, email, display_name, created_at
        "#,
    )
    .bind(&email)
    .bind(&display_name)
    .bind(&password_hash)
    .bind(auth.user_id)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| match e {
        sqlx::Error::Database(db) if db.constraint().is_some() => {
            ApiError::from(DomainError::Conflict("email already in use".into()))
        }
        other => ApiError::from(DomainError::Internal(other.to_string())),
    })?;

    Ok(Json(MeResponse {
        user,
        is_super_admin: admin::is_super_admin(&state.pool, auth.user_id).await?,
        has_password: password_hash.is_some(),
    }))
}

#[derive(Deserialize)]
struct UserSearchQuery {
    q: String,
    #[serde(default = "default_user_search_limit")]
    limit: usize,
}

fn default_user_search_limit() -> usize {
    20
}

async fn search_users(
    State(state): State<AppState>,
    _auth: AuthUser,
    Query(query): Query<UserSearchQuery>,
) -> Result<Json<Vec<UserPublic>>, ApiError> {
    let q = query.q.trim();
    if q.is_empty() {
        return Ok(Json(vec![]));
    }

    let limit = query.limit.clamp(1, 50) as i64;
    let pattern = format!("%{q}%");

    let users = sqlx::query_as::<_, UserPublic>(
        r#"
        SELECT id, username, email, display_name, created_at
        FROM users
        WHERE username ILIKE $1
           OR email ILIKE $1
           OR COALESCE(display_name, '') ILIKE $1
        ORDER BY username
        LIMIT $2
        "#,
    )
    .bind(&pattern)
    .bind(limit)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    Ok(Json(users))
}

fn repo_response(config: &Config, org_slug: &str, repository: Repository) -> RepositoryResponse {
    RepositoryResponse {
        clone_url_http: config.clone_url_http(org_slug, &repository.slug),
        clone_url_ssh: config.clone_url_ssh(org_slug, &repository.slug),
        repository,
    }
}

async fn list_ssh_keys(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<Vec<UserSshKey>>, ApiError> {
    let keys = sqlx::query_as::<_, UserSshKey>(
        r#"
        SELECT id, user_id, title, public_key, fingerprint, created_at
        FROM user_ssh_keys
        WHERE user_id = $1
        ORDER BY created_at DESC
        "#,
    )
    .bind(auth.user_id)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    Ok(Json(keys))
}

async fn create_ssh_key(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(body): Json<CreateSshKeyRequest>,
) -> Result<(StatusCode, Json<UserSshKey>), ApiError> {
    body.validate()
        .map_err(|e| ApiError::from(DomainError::Validation(e.to_string())))?;

    let parsed = ssh_keys::parse_public_key(&body.public_key)
        .map_err(|e| ApiError::from(DomainError::Validation(e.to_string())))?;

    let key = sqlx::query_as::<_, UserSshKey>(
        r#"
        INSERT INTO user_ssh_keys (user_id, title, public_key, fingerprint)
        VALUES ($1, $2, $3, $4)
        RETURNING id, user_id, title, public_key, fingerprint, created_at
        "#,
    )
    .bind(auth.user_id)
    .bind(&body.title)
    .bind(&parsed.public_key)
    .bind(&parsed.fingerprint)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| match e {
        sqlx::Error::Database(db) if db.constraint().is_some() => {
            ApiError::from(DomainError::Conflict(
                "ssh key fingerprint or title already exists".into(),
            ))
        }
        other => ApiError::from(DomainError::Internal(other.to_string())),
    })?;

    Ok((StatusCode::CREATED, Json(key)))
}

async fn delete_ssh_key(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(key_id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    let result = sqlx::query(
        r#"
        DELETE FROM user_ssh_keys
        WHERE id = $1 AND user_id = $2
        "#,
    )
    .bind(key_id)
    .bind(auth.user_id)
    .execute(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    if result.rows_affected() == 0 {
        return Err(DomainError::NotFound.into());
    }

    Ok(StatusCode::NO_CONTENT)
}

async fn list_organizations(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<Vec<OrganizationListItem>>, ApiError> {
    let rows = sqlx::query_as::<_, OrganizationListRow>(
        r#"
        SELECT DISTINCT
            o.id,
            o.slug,
            o.name,
            o.description,
            o.parent_id,
            o.full_path,
            o.created_at,
            o.updated_at,
            EXISTS (
                SELECT 1
                FROM organization_members m
                INNER JOIN organizations member_org ON member_org.id = m.organization_id
                WHERE m.user_id = $1
                  AND (
                    o.full_path = member_org.full_path
                    OR o.full_path LIKE member_org.full_path || '/%'
                  )
            ) AS is_member
        FROM organizations o
        WHERE EXISTS (
            SELECT 1
            FROM organization_members m
            INNER JOIN organizations member_org ON member_org.id = m.organization_id
            WHERE m.user_id = $1
              AND (
                o.full_path = member_org.full_path
                OR o.full_path LIKE member_org.full_path || '/%'
              )
        )
        OR EXISTS (
            SELECT 1
            FROM repositories r
            WHERE r.organization_id = o.id
              AND r.visibility = 'public'
        )
        ORDER BY o.full_path
        "#,
    )
    .bind(auth.user_id)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    Ok(Json(
        rows.into_iter()
            .map(|row| OrganizationListItem {
                organization: Organization {
                    id: row.id,
                    slug: row.slug,
                    name: row.name,
                    description: row.description,
                    parent_id: row.parent_id,
                    full_path: row.full_path,
                    created_at: row.created_at,
                    updated_at: row.updated_at,
                },
                is_member: row.is_member,
            })
            .collect(),
    ))
}

#[derive(Debug, sqlx::FromRow)]
struct OrganizationListRow {
    id: Uuid,
    slug: String,
    name: String,
    description: Option<String>,
    parent_id: Option<Uuid>,
    full_path: String,
    created_at: chrono::DateTime<chrono::Utc>,
    updated_at: chrono::DateTime<chrono::Utc>,
    is_member: bool,
}

#[derive(Serialize)]
struct OrganizationListItem {
    #[serde(flatten)]
    organization: Organization,
    is_member: bool,
}

async fn list_organization_subgroups(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(org_path): Path<String>,
) -> Result<Json<Vec<Organization>>, ApiError> {
    let org = crate::org::find_org_for_browse(
        &state.pool,
        &org::org_path_from_param(&org_path),
        auth.user_id,
    )
    .await?;
    let subgroups = org::list_subgroups(&state.pool, org.id).await?;
    Ok(Json(subgroups))
}

#[derive(Serialize)]
struct OrgMemberCustomRoleSummary {
    id: Uuid,
    name: String,
    slug: String,
}

#[derive(Serialize)]
struct OrgMemberResponse {
    user: UserPublic,
    role: OrgRole,
    custom_role: Option<OrgMemberCustomRoleSummary>,
}

#[derive(sqlx::FromRow)]
struct OrgMemberRow {
    id: Uuid,
    username: String,
    email: String,
    display_name: Option<String>,
    created_at: chrono::DateTime<chrono::Utc>,
    role: OrgRole,
    custom_role_id: Option<Uuid>,
    custom_role_name: Option<String>,
    custom_role_slug: Option<String>,
}

async fn list_organization_members(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(org_path): Path<String>,
) -> Result<Json<Vec<OrgMemberResponse>>, ApiError> {
    find_org_for_member(&state.pool, &crate::org::org_path_from_param(&org_path), auth.user_id).await?;

    let rows = sqlx::query_as::<_, OrgMemberRow>(
        r#"
        SELECT
            u.id,
            u.username,
            u.email,
            u.display_name,
            u.created_at,
            m.role,
            cr.id AS custom_role_id,
            cr.name AS custom_role_name,
            cr.slug AS custom_role_slug
        FROM organization_members m
        INNER JOIN users u ON u.id = m.user_id
        INNER JOIN organizations o ON o.id = m.organization_id
        LEFT JOIN organization_custom_roles cr ON cr.id = m.custom_role_id
        WHERE o.full_path = $1
        ORDER BY u.username
        "#,
    )
    .bind(&crate::org::org_path_from_param(&org_path))
    .fetch_all(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    Ok(Json(
        rows.into_iter()
            .map(|row| OrgMemberResponse {
                user: UserPublic {
                    id: row.id,
                    username: row.username,
                    email: row.email,
                    display_name: row.display_name,
                    created_at: row.created_at,
                },
                role: row.role,
                custom_role: row.custom_role_id.map(|id| OrgMemberCustomRoleSummary {
                    id,
                    name: row.custom_role_name.unwrap_or_default(),
                    slug: row.custom_role_slug.unwrap_or_default(),
                }),
            })
            .collect(),
    ))
}

async fn create_organization(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(body): Json<CreateOrganizationRequest>,
) -> Result<(StatusCode, Json<Organization>), ApiError> {
    body.validate()
        .map_err(|e| ApiError::from(DomainError::Validation(e.to_string())))?;

    let parent_id = if let Some(ref parent_path) = body.parent_path {
        let parent_path = normalize_org_path(parent_path);
        if parent_path.is_empty() {
            None
        } else {
            let parent =
                find_org_for_member(&state.pool, &parent_path, auth.user_id).await?;
            permissions::ensure_can_manage_org_settings(&state.pool, parent.id, auth.user_id)
                .await?;
            Some(parent.id)
        }
    } else {
        None
    };

    let parent_full_path = if let Some(parent_id) = parent_id {
        sqlx::query_scalar::<_, String>("SELECT full_path FROM organizations WHERE id = $1")
            .bind(parent_id)
            .fetch_one(&state.pool)
            .await
            .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?
    } else {
        String::new()
    };

    let full_path = if parent_full_path.is_empty() {
        body.slug.clone()
    } else {
        join_org_path(&parent_full_path, &body.slug)
    };

    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    let org = sqlx::query_as::<_, Organization>(
        r#"
        INSERT INTO organizations (slug, name, description, parent_id, full_path)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, slug, name, description, parent_id, full_path, created_at, updated_at
        "#,
    )
    .bind(&body.slug)
    .bind(&body.name)
    .bind(&body.description)
    .bind(parent_id)
    .bind(&full_path)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| match e {
        sqlx::Error::Database(db) if db.constraint().is_some() => {
            ApiError::from(DomainError::Conflict("group path already exists".into()))
        }
        other => ApiError::from(DomainError::Internal(other.to_string())),
    })?;

    sqlx::query(
        r#"
        INSERT INTO organization_members (organization_id, user_id, role)
        VALUES ($1, $2, 'owner')
        "#,
    )
    .bind(org.id)
    .bind(auth.user_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    tx.commit()
        .await
        .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    Ok((StatusCode::CREATED, Json(org)))
}

async fn update_organization(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(org_path): Path<String>,
    Json(body): Json<UpdateOrganizationRequest>,
) -> Result<Json<Organization>, ApiError> {
    body.validate()
        .map_err(|e| ApiError::from(DomainError::Validation(e.to_string())))?;

    if body.name.is_none() && body.slug.is_none() && body.description.is_none() {
        return Err(DomainError::Validation("no fields to update".into()).into());
    }

    let org = find_org_for_member(&state.pool, &crate::org::org_path_from_param(&org_path), auth.user_id).await?;
    permissions::ensure_can_manage_org_settings(&state.pool, org.id, auth.user_id).await?;

    let name = body.name.unwrap_or_else(|| org.name.clone());
    let new_slug = body.slug.unwrap_or_else(|| org.slug.clone());
    let description = match body.description {
        Some(value) => {
            if value.trim().is_empty() {
                None
            } else {
                Some(value)
            }
        }
        None => org.description.clone(),
    };

    let parent_full_path = if let Some(parent_id) = org.parent_id {
        sqlx::query_scalar::<_, String>("SELECT full_path FROM organizations WHERE id = $1")
            .bind(parent_id)
            .fetch_one(&state.pool)
            .await
            .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?
    } else {
        String::new()
    };

    let new_full_path = if parent_full_path.is_empty() {
        new_slug.clone()
    } else {
        join_org_path(&parent_full_path, &new_slug)
    };

    if new_full_path != org.full_path {
        let old_dir = group_storage_dir(&state.config.repos_root, &org.full_path);
        let new_dir = group_storage_dir(&state.config.repos_root, &new_full_path);
        if old_dir.exists() {
            if new_dir.exists() {
                return Err(DomainError::Conflict(
                    "cannot rename group: target storage path already exists".into(),
                )
                .into());
            }
        }
    }

    let mut renamed_storage = false;
    let old_dir = group_storage_dir(&state.config.repos_root, &org.full_path);
    let new_dir = group_storage_dir(&state.config.repos_root, &new_full_path);
    if new_full_path != org.full_path && old_dir.exists() {
        if let Some(parent) = new_dir.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;
        }
        tokio::fs::rename(&old_dir, &new_dir)
            .await
            .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;
        renamed_storage = true;
    }

    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    if new_full_path != org.full_path {
        sqlx::query(
            r#"
            UPDATE organizations
            SET full_path = $2 || substring(full_path FROM char_length($1) + 1)
            WHERE full_path = $1 OR full_path LIKE $1 || '/%'
            "#,
        )
        .bind(&org.full_path)
        .bind(&new_full_path)
        .execute(&mut *tx)
        .await
        .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;
    }

    let updated = match sqlx::query_as::<_, Organization>(
        r#"
        UPDATE organizations
        SET name = $1,
            slug = $2,
            description = $3,
            updated_at = NOW()
        WHERE id = $4
        RETURNING id, slug, name, description, parent_id, full_path, created_at, updated_at
        "#,
    )
    .bind(&name)
    .bind(&new_slug)
    .bind(&description)
    .bind(org.id)
    .fetch_one(&mut *tx)
    .await
    {
        Ok(org) => org,
        Err(e) => {
            if renamed_storage {
                let _ = tokio::fs::rename(&new_dir, &old_dir).await;
            }
            return Err(match e {
                sqlx::Error::Database(db) if db.constraint().is_some() => {
                    ApiError::from(DomainError::Conflict("group path already exists".into()))
                }
                other => ApiError::from(DomainError::Internal(other.to_string())),
            });
        }
    };

    tx.commit()
        .await
        .map_err(|e| {
            if renamed_storage {
                let old_dir = old_dir.clone();
                let new_dir = new_dir.clone();
                tokio::spawn(async move {
                    let _ = tokio::fs::rename(new_dir, old_dir).await;
                });
            }
            ApiError::from(DomainError::Internal(e.to_string()))
        })?;

    let _ = audit::record_audit_event(
        &state.pool,
        audit::AuditEventInput {
            organization_id: Some(org.id),
            actor_user_id: Some(auth.user_id),
            event_type: AuditEventType::PermissionChange,
            action: format!("updated group settings (slug: {} → {})", org.slug, updated.slug),
            resource_type: Some("organization".into()),
            resource_id: Some(org.id.to_string()),
            metadata: Some(serde_json::json!({
                "old_slug": org.slug,
                "new_slug": updated.slug,
                "name": updated.name,
            })),
            ip_address: None,
            user_agent: None,
        },
    )
    .await;

    Ok(Json(updated))
}

#[derive(Debug, Deserialize)]
struct ListRepositoriesQuery {
    #[serde(default)]
    recursive: bool,
}

#[derive(Debug, sqlx::FromRow)]
struct RepositoryListRow {
    id: Uuid,
    organization_id: Uuid,
    name: String,
    slug: String,
    description: Option<String>,
    visibility: RepoVisibility,
    default_branch: String,
    created_at: chrono::DateTime<chrono::Utc>,
    updated_at: chrono::DateTime<chrono::Utc>,
    last_commit_at: Option<chrono::DateTime<chrono::Utc>>,
    organization_path: String,
}

#[derive(Serialize)]
struct RepositoryListItem {
    #[serde(flatten)]
    repository: Repository,
    organization_path: String,
}

async fn list_repositories(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(org_path): Path<String>,
    Query(query): Query<ListRepositoriesQuery>,
) -> Result<Json<Vec<RepositoryListItem>>, ApiError> {
    let org_path = crate::org::org_path_from_param(&org_path);
    let org = crate::org::find_org_by_path(&state.pool, &org_path).await?;
    let is_member = crate::org::is_org_member(&state.pool, org.id, auth.user_id).await?;

    let mut repos = if query.recursive {
        sqlx::query_as::<_, RepositoryListRow>(
            r#"
            SELECT
                r.id,
                r.organization_id,
                r.name,
                r.slug,
                r.description,
                r.visibility,
                r.default_branch,
                r.created_at,
                r.updated_at,
                r.last_commit_at,
                o.full_path AS organization_path
            FROM repositories r
            INNER JOIN organizations o ON o.id = r.organization_id
            WHERE (o.full_path = $1 OR o.full_path LIKE $1 || '/%')
              AND ($2 OR r.visibility = 'public')
            ORDER BY o.full_path, r.name
            "#,
        )
        .bind(&org_path)
        .bind(is_member)
        .fetch_all(&state.pool)
        .await
    } else {
        sqlx::query_as::<_, RepositoryListRow>(
            r#"
            SELECT
                r.id,
                r.organization_id,
                r.name,
                r.slug,
                r.description,
                r.visibility,
                r.default_branch,
                r.created_at,
                r.updated_at,
                r.last_commit_at,
                o.full_path AS organization_path
            FROM repositories r
            INNER JOIN organizations o ON o.id = r.organization_id
            WHERE r.organization_id = $1
              AND ($2 OR r.visibility = 'public')
            ORDER BY r.name
            "#,
        )
        .bind(org.id)
        .bind(is_member)
        .fetch_all(&state.pool)
        .await
    }
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    if repos.iter().any(|repo| repo.last_commit_at.is_none()) {
        let pool = state.pool.clone();
        let repos_root = state.config.repos_root.clone();
        for repo in repos.iter_mut().filter(|repo| repo.last_commit_at.is_none()) {
            let mut repository = Repository {
                id: repo.id,
                organization_id: repo.organization_id,
                name: repo.name.clone(),
                slug: repo.slug.clone(),
                description: repo.description.clone(),
                visibility: repo.visibility,
                default_branch: repo.default_branch.clone(),
                created_at: repo.created_at,
                updated_at: repo.updated_at,
                last_commit_at: repo.last_commit_at,
            };
            repository_activity::backfill_repository_last_commit_at(
                &pool,
                &repos_root,
                &repo.organization_path,
                &mut repository,
            )
            .await;
            repo.last_commit_at = repository.last_commit_at;
        }
    }

    Ok(Json(
        repos
            .into_iter()
            .map(|row| RepositoryListItem {
                repository: Repository {
                    id: row.id,
                    organization_id: row.organization_id,
                    name: row.name,
                    slug: row.slug,
                    description: row.description,
                    visibility: row.visibility,
                    default_branch: row.default_branch,
                    created_at: row.created_at,
                    updated_at: row.updated_at,
                    last_commit_at: row.last_commit_at,
                },
                organization_path: row.organization_path,
            })
            .collect(),
    ))
}

async fn create_repository(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(org_path): Path<String>,
    Json(body): Json<CreateRepositoryRequest>,
) -> Result<(StatusCode, Json<Repository>), ApiError> {
    body.validate()
        .map_err(|e| ApiError::from(DomainError::Validation(e.to_string())))?;

    let org = find_org_for_member(&state.pool, &crate::org::org_path_from_param(&org_path), auth.user_id).await?;
    let visibility = body.visibility.unwrap_or(RepoVisibility::Private);

    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    let repo = sqlx::query_as::<_, Repository>(
        r#"
        INSERT INTO repositories (organization_id, name, slug, description, visibility)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, organization_id, name, slug, description, visibility, default_branch, created_at, updated_at, last_commit_at
        "#,
    )
    .bind(org.id)
    .bind(&body.name)
    .bind(&body.slug)
    .bind(&body.description)
    .bind(visibility)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| match e {
        sqlx::Error::Database(db) if db.constraint().is_some() => {
            ApiError::from(DomainError::Conflict("repository slug already exists".into()))
        }
        other => ApiError::from(DomainError::Internal(other.to_string())),
    })?;

    sqlx::query(
        r#"
        INSERT INTO repository_permissions (repository_id, user_id, role)
        VALUES ($1, $2, 'admin')
        "#,
    )
    .bind(repo.id)
    .bind(auth.user_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    tx.commit()
        .await
        .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    init_bare_repo(&state.config.repos_root, &crate::org::org_path_from_param(&org_path), &repo.slug)
        .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    Ok((StatusCode::CREATED, Json(repo)))
}

async fn get_repository(
    State(state): State<AppState>,
    OptionalAuth(auth): OptionalAuth,
    Path((org_path, repo_slug)): Path<(String, String)>,
) -> Result<Json<RepositoryResponse>, ApiError> {
    let (_org, repo, _repo_path) =
        load_repo_for_read(&state, &crate::org::org_path_from_param(&org_path), &repo_slug, auth.as_ref()).await?;

    Ok(Json(repo_response(&state.config, &crate::org::org_path_from_param(&org_path), repo)))
}

async fn update_repository(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_path, repo_slug)): Path<(String, String)>,
    Json(body): Json<UpdateRepositoryRequest>,
) -> Result<Json<RepositoryResponse>, ApiError> {
    body.validate()
        .map_err(|e| ApiError::from(DomainError::Validation(e.to_string())))?;

    if body.name.is_none()
        && body.description.is_none()
        && body.visibility.is_none()
        && body.default_branch.is_none()
    {
        return Err(DomainError::Validation("no fields to update".into()).into());
    }

    let org = find_org_for_member(&state.pool, &crate::org::org_path_from_param(&org_path), auth.user_id).await?;

    let repo = sqlx::query_as::<_, Repository>(
        r#"
        SELECT id, organization_id, name, slug, description, visibility, default_branch, created_at, updated_at, last_commit_at
        FROM repositories
        WHERE organization_id = $1 AND slug = $2
        "#,
    )
    .bind(org.id)
    .bind(&repo_slug)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?
    .ok_or(DomainError::NotFound)?;

    ensure_can_write_repo(&state, &crate::org::org_path_from_param(&org_path), &repo, &auth).await?;

    if let Some(default_branch) = &body.default_branch {
        let repo_path = repo_disk_path(&state.config.repos_root, &crate::org::org_path_from_param(&org_path), &repo.slug);
        if !explorer::ref_exists(&repo_path, default_branch)
            .await
            .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?
        {
            return Err(DomainError::Validation(format!(
                "branch '{default_branch}' does not exist in the repository"
            ))
            .into());
        }
    }

    let name = body.name.unwrap_or_else(|| repo.name.clone());
    let description = match body.description {
        Some(value) => {
            if value.trim().is_empty() {
                None
            } else {
                Some(value)
            }
        }
        None => repo.description,
    };
    let visibility = body.visibility.unwrap_or(repo.visibility);
    let default_branch = body
        .default_branch
        .unwrap_or_else(|| repo.default_branch.clone());

    let updated = sqlx::query_as::<_, Repository>(
        r#"
        UPDATE repositories
        SET name = $1,
            description = $2,
            visibility = $3,
            default_branch = $4,
            updated_at = NOW()
        WHERE id = $5
        RETURNING id, organization_id, name, slug, description, visibility, default_branch, created_at, updated_at, last_commit_at
        "#,
    )
    .bind(name)
    .bind(description)
    .bind(visibility)
    .bind(default_branch)
    .bind(repo.id)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    Ok(Json(repo_response(&state.config, &crate::org::org_path_from_param(&org_path), updated)))
}

async fn delete_organization(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(org_path): Path<String>,
    Query(query): Query<DeleteOrganizationQuery>,
) -> Result<StatusCode, ApiError> {
    let org_path = crate::org::org_path_from_param(&org_path);
    let org = find_org_for_member(&state.pool, &org_path, auth.user_id).await?;
    permissions::ensure_org_owner(&state.pool, org.id, auth.user_id).await?;

    if !query.cascade {
        let child_orgs: i64 = sqlx::query_scalar(
            "SELECT COUNT(*)::bigint FROM organizations WHERE parent_id = $1",
        )
        .bind(org.id)
        .fetch_one(&state.pool)
        .await
        .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

        if child_orgs > 0 {
            return Err(DomainError::Validation(
                "cannot delete group: move or delete subgroups first, or use ?cascade=true"
                    .into(),
            )
            .into());
        }

        let repo_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*)::bigint FROM repositories WHERE organization_id = $1",
        )
        .bind(org.id)
        .fetch_one(&state.pool)
        .await
        .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

        if repo_count > 0 {
            return Err(DomainError::Validation(
                "cannot delete group: move or delete repositories first, or use ?cascade=true"
                    .into(),
            )
            .into());
        }
    }

    sqlx::query("DELETE FROM organizations WHERE id = $1")
        .bind(org.id)
        .execute(&state.pool)
        .await
        .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    let storage_dir = group_storage_dir(&state.config.repos_root, &org.full_path);
    if storage_dir.exists() {
        tokio::fs::remove_dir_all(&storage_dir)
            .await
            .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;
    }

    Ok(StatusCode::NO_CONTENT)
}

async fn delete_repository(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_path, repo_slug)): Path<(String, String)>,
) -> Result<StatusCode, ApiError> {
    let org_path = crate::org::org_path_from_param(&org_path);
    let org = find_org_for_member(&state.pool, &org_path, auth.user_id).await?;

    let repo = sqlx::query_as::<_, Repository>(
        r#"
        SELECT id, organization_id, name, slug, description, visibility, default_branch, created_at, updated_at, last_commit_at
        FROM repositories
        WHERE organization_id = $1 AND slug = $2
        "#,
    )
    .bind(org.id)
    .bind(&repo_slug)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?
    .ok_or(DomainError::NotFound)?;

    permissions::ensure_can_admin_repo(&state.pool, org.id, &repo, &auth).await?;

    sqlx::query("DELETE FROM repositories WHERE id = $1")
        .bind(repo.id)
        .execute(&state.pool)
        .await
        .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    let repo_path = repo_disk_path(&state.config.repos_root, &org_path, &repo.slug);
    if repo_path.exists() {
        tokio::fs::remove_dir_all(&repo_path)
            .await
            .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;
    }

    Ok(StatusCode::NO_CONTENT)
}

async fn transfer_repository(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_path, repo_slug)): Path<(String, String)>,
    Json(body): Json<TransferRepositoryRequest>,
) -> Result<Json<RepositoryResponse>, ApiError> {
    body.validate()
        .map_err(|e| ApiError::from(DomainError::Validation(e.to_string())))?;

    let source_path = crate::org::org_path_from_param(&org_path);
    let target_path = normalize_org_path(&body.target_org_path);
    if target_path.is_empty() {
        return Err(DomainError::Validation("target group path is required".into()).into());
    }
    if target_path == source_path {
        return Err(DomainError::Validation(
            "repository is already in this group".into(),
        )
        .into());
    }

    let source_org = find_org_for_member(&state.pool, &source_path, auth.user_id).await?;
    let target_org = find_org_for_member(&state.pool, &target_path, auth.user_id).await?;
    permissions::ensure_can_manage_org_settings(&state.pool, target_org.id, auth.user_id).await?;

    let repo = sqlx::query_as::<_, Repository>(
        r#"
        SELECT id, organization_id, name, slug, description, visibility, default_branch, created_at, updated_at, last_commit_at
        FROM repositories
        WHERE organization_id = $1 AND slug = $2
        "#,
    )
    .bind(source_org.id)
    .bind(&repo_slug)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?
    .ok_or(DomainError::NotFound)?;

    permissions::ensure_can_admin_repo(&state.pool, source_org.id, &repo, &auth).await?;

    let conflict: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM repositories WHERE organization_id = $1 AND slug = $2)",
    )
    .bind(target_org.id)
    .bind(&repo.slug)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    if conflict {
        return Err(DomainError::Conflict(format!(
            "a repository named '{}' already exists in the target group",
            repo.slug
        ))
        .into());
    }

    let old_disk = repo_disk_path(&state.config.repos_root, &source_path, &repo.slug);
    let new_disk = repo_disk_path(&state.config.repos_root, &target_path, &repo.slug);
    if new_disk.exists() {
        return Err(DomainError::Conflict(
            "cannot transfer repository: target storage path already exists".into(),
        )
        .into());
    }

    if old_disk.exists() {
        if let Some(parent) = new_disk.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;
        }
        tokio::fs::rename(&old_disk, &new_disk)
            .await
            .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;
    }

    let updated = match sqlx::query_as::<_, Repository>(
        r#"
        UPDATE repositories
        SET organization_id = $1, updated_at = NOW()
        WHERE id = $2
        RETURNING id, organization_id, name, slug, description, visibility, default_branch, created_at, updated_at, last_commit_at
        "#,
    )
    .bind(target_org.id)
    .bind(repo.id)
    .fetch_one(&state.pool)
    .await
    {
        Ok(row) => row,
        Err(err) => {
            if new_disk.exists() && !old_disk.exists() {
                if let Some(parent) = old_disk.parent() {
                    let _ = tokio::fs::create_dir_all(parent).await;
                }
                let _ = tokio::fs::rename(&new_disk, &old_disk).await;
            }
            return Err(ApiError::from(DomainError::Internal(err.to_string())));
        }
    };

    Ok(Json(repo_response(&state.config, &target_path, updated)))
}

fn group_storage_dir(root: &std::path::Path, org_path: &str) -> std::path::PathBuf {
    let mut path = root.to_path_buf();
    for segment in org_path.split('/').filter(|s| !s.is_empty()) {
        path.push(segment);
    }
    path
}

pub(crate) async fn ensure_can_write_repo(
    state: &AppState,
    org_path: &str,
    repo: &Repository,
    auth: &AuthUser,
) -> Result<(), ApiError> {
    let org = org::find_org_by_path(&state.pool, org_path).await?;
    let record = RepoRecord {
        id: repo.id,
        org_id: org.id,
        org_path: org.full_path,
        repo_slug: repo.slug.clone(),
        visibility: repo.visibility,
    };
    let user = GitAuthUser {
        id: auth.user_id,
        username: auth.username.clone(),
    };

    let allowed = access::can_write_repo(&state.pool, &record, &user)
        .await
        .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    if !allowed {
        return Err(DomainError::Forbidden.into());
    }

    Ok(())
}

#[derive(Deserialize)]
struct DeleteOrganizationQuery {
    #[serde(default)]
    cascade: bool,
}

#[derive(Deserialize)]
struct TreeQuery {
    #[serde(default = "default_ref")]
    r#ref: String,
    #[serde(default)]
    path: String,
    #[serde(default = "default_ref_kind")]
    ref_kind: String,
}

fn default_ref() -> String {
    "main".into()
}

fn default_ref_kind() -> String {
    "branch".into()
}

fn parse_ref_kind(kind: &str) -> Result<RefKind, ApiError> {
    match kind {
        "branch" => Ok(RefKind::Branch),
        "tag" => Ok(RefKind::Tag),
        _ => Err(DomainError::Validation("ref_kind must be branch or tag".into()).into()),
    }
}

fn guess_content_type(path: &str) -> &'static str {
    match path.rsplit('.').next() {
        Some("md" | "txt" | "rs" | "js" | "ts" | "tsx" | "json" | "html" | "css" | "yml" | "yaml")
        => "text/plain; charset=utf-8",
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("svg") => "image/svg+xml",
        Some("pdf") => "application/pdf",
        _ => "application/octet-stream",
    }
}

#[derive(Deserialize)]
struct BlobQuery {
    #[serde(default = "default_ref")]
    r#ref: String,
    path: String,
    #[serde(default = "default_ref_kind")]
    ref_kind: String,
}

#[derive(Deserialize)]
struct CommitsQuery {
    #[serde(default = "default_ref")]
    r#ref: String,
    #[serde(default = "default_commit_limit")]
    limit: u32,
    #[serde(default = "default_ref_kind")]
    ref_kind: String,
}

fn default_commit_limit() -> u32 {
    30
}

#[derive(Serialize)]
struct BrowserResponse {
    browser: RepoBrowser,
}

#[derive(Serialize)]
struct TreeResponse {
    entries: Vec<TreeEntry>,
    path: String,
    r#ref: String,
}

#[derive(Serialize)]
struct BlobResponse {
    path: String,
    r#ref: String,
    content: String,
    is_binary: bool,
}

#[derive(Serialize)]
struct BlameResponse {
    path: String,
    r#ref: String,
    lines: Vec<BlameLine>,
}

#[derive(Serialize)]
struct CommitsResponse {
    commits: Vec<CommitInfo>,
    r#ref: String,
}

#[derive(Serialize)]
struct TagsResponse {
    tags: Vec<TagInfo>,
}

#[derive(Serialize)]
struct BranchesResponse {
    branches: Vec<BranchInfo>,
}

#[derive(Serialize)]
struct CommitResponse {
    commit: CommitDetail,
}

pub(crate) async fn load_repo_for_read(
    state: &AppState,
    org_path: &str,
    repo_slug: &str,
    user: Option<&AuthUser>,
) -> Result<(Organization, Repository, std::path::PathBuf), ApiError> {
    let org = org::find_org_by_path(&state.pool, org_path).await?;

    let repo = sqlx::query_as::<_, Repository>(
        r#"
        SELECT id, organization_id, name, slug, description, visibility, default_branch, created_at, updated_at, last_commit_at
        FROM repositories
        WHERE organization_id = $1 AND slug = $2
        "#,
    )
    .bind(org.id)
    .bind(repo_slug)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?
    .ok_or(DomainError::NotFound)?;

    ensure_can_read_repo(state, &org.full_path, &repo, user).await?;

    ensure_bare_repo(&state.config.repos_root, &org.full_path, &repo.slug)
        .await
        .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    let repo_path = repo_disk_path(&state.config.repos_root, &org.full_path, &repo.slug);
    Ok((org, repo, repo_path))
}

pub(crate) async fn ensure_can_read_repo(
    state: &AppState,
    org_path: &str,
    repo: &Repository,
    user: Option<&AuthUser>,
) -> Result<(), ApiError> {
    let org = org::find_org_by_path(&state.pool, org_path).await?;
    let record = RepoRecord {
        id: repo.id,
        org_id: org.id,
        org_path: org.full_path,
        repo_slug: repo.slug.clone(),
        visibility: repo.visibility,
    };
    let git_user = user.map(|auth| GitAuthUser {
        id: auth.user_id,
        username: auth.username.clone(),
    });

    let allowed = access::can_read_repo(&state.pool, &record, git_user.as_ref())
        .await
        .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    if allowed {
        return Ok(());
    }

    if user.is_none() {
        Err(DomainError::Unauthorized.into())
    } else {
        Err(DomainError::Forbidden.into())
    }
}

pub(crate) fn map_explorer_error(err: anyhow::Error) -> ApiError {
    let msg = err.to_string();
    let lower = msg.to_lowercase();
    if lower.contains("not found") || lower.contains("unknown revision") || lower.contains("bad revision") {
        ApiError::from(DomainError::NotFound)
    } else if lower.contains("merge conflict") {
        ApiError::from(DomainError::Validation(
            "merge conflict: update the source branch with the latest target branch, resolve conflicts, then try again".into(),
        ))
    } else if lower.contains("invalid path")
        || lower.contains("binary content is not supported")
        || lower.contains("no file changes provided")
        || (lower.contains("branch '") && lower.contains("not found"))
    {
        ApiError::from(DomainError::Validation(msg))
    } else if lower.contains("git ") && lower.contains("failed") {
        ApiError::from(DomainError::Validation(msg))
    } else {
        ApiError::from(DomainError::Internal(msg))
    }
}

fn is_missing_git_ref(err: &anyhow::Error) -> bool {
    let msg = err.to_string().to_lowercase();
    (msg.contains("branch") || msg.contains("tag") || msg.contains("revision"))
        && (msg.contains("not found") || msg.contains("unknown") || msg.contains("bad revision"))
}

async fn get_repo_browser(
    State(state): State<AppState>,
    OptionalAuth(auth): OptionalAuth,
    Path((org_path, repo_slug)): Path<(String, String)>,
) -> Result<Json<BrowserResponse>, ApiError> {
    let (_org, repo, repo_path) =
        load_repo_for_read(&state, &crate::org::org_path_from_param(&org_path), &repo_slug, auth.as_ref()).await?;

    let browser = if !repo_exists_on_disk(
        &state.config.repos_root,
        &_org.full_path,
        &repo.slug,
    ) {
        RepoBrowser {
            branches: vec![],
            tags: vec![],
            default_ref: repo.default_branch.clone(),
            empty: true,
        }
    } else {
        explorer::repo_browser(&repo_path, &repo.default_branch)
            .await
            .map_err(map_explorer_error)?
    };

    Ok(Json(BrowserResponse { browser }))
}

async fn get_repo_tree(
    State(state): State<AppState>,
    OptionalAuth(auth): OptionalAuth,
    Path((org_path, repo_slug)): Path<(String, String)>,
    Query(query): Query<TreeQuery>,
) -> Result<Json<TreeResponse>, ApiError> {
    let (_org, _repo, repo_path) =
        load_repo_for_read(&state, &crate::org::org_path_from_param(&org_path), &repo_slug, auth.as_ref()).await?;
    let ref_kind = parse_ref_kind(&query.ref_kind)?;

    let entries = explorer::list_tree(&repo_path, &query.r#ref, ref_kind, &query.path)
        .await
        .map_err(map_explorer_error)?;

    Ok(Json(TreeResponse {
        entries,
        path: query.path,
        r#ref: query.r#ref,
    }))
}

async fn get_repo_blame(
    State(state): State<AppState>,
    OptionalAuth(auth): OptionalAuth,
    Path((org_path, repo_slug)): Path<(String, String)>,
    Query(query): Query<BlobQuery>,
) -> Result<Json<BlameResponse>, ApiError> {
    if query.path.is_empty() {
        return Err(DomainError::Validation("path is required".into()).into());
    }

    let (_org, _repo, repo_path) =
        load_repo_for_read(&state, &crate::org::org_path_from_param(&org_path), &repo_slug, auth.as_ref()).await?;
    let ref_kind = parse_ref_kind(&query.ref_kind)?;

    let lines = explorer::file_blame(&repo_path, &query.r#ref, ref_kind, &query.path)
        .await
        .map_err(map_explorer_error)?;

    Ok(Json(BlameResponse {
        path: query.path,
        r#ref: query.r#ref,
        lines,
    }))
}

async fn get_repo_blob(
    State(state): State<AppState>,
    OptionalAuth(auth): OptionalAuth,
    Path((org_path, repo_slug)): Path<(String, String)>,
    Query(query): Query<BlobQuery>,
) -> Result<Json<BlobResponse>, ApiError> {
    if query.path.is_empty() {
        return Err(DomainError::Validation("path is required".into()).into());
    }

    let (_org, _repo, repo_path) =
        load_repo_for_read(&state, &crate::org::org_path_from_param(&org_path), &repo_slug, auth.as_ref()).await?;
    let ref_kind = parse_ref_kind(&query.ref_kind)?;

    let content = explorer::read_blob(&repo_path, &query.r#ref, ref_kind, &query.path)
        .await
        .map_err(map_explorer_error)?;

    let is_binary = content.bytes().any(|b| b == 0);

    Ok(Json(BlobResponse {
        path: query.path,
        r#ref: query.r#ref,
        content,
        is_binary,
    }))
}

async fn get_repo_raw(
    State(state): State<AppState>,
    OptionalAuth(auth): OptionalAuth,
    Path((org_path, repo_slug)): Path<(String, String)>,
    Query(query): Query<BlobQuery>,
) -> Result<Response, ApiError> {
    if query.path.is_empty() {
        return Err(DomainError::Validation("path is required".into()).into());
    }

    let (_org, _repo, repo_path) =
        load_repo_for_read(&state, &crate::org::org_path_from_param(&org_path), &repo_slug, auth.as_ref()).await?;
    let ref_kind = parse_ref_kind(&query.ref_kind)?;

    let bytes = explorer::read_blob_bytes(&repo_path, &query.r#ref, ref_kind, &query.path)
        .await
        .map_err(map_explorer_error)?;

    let filename = query
        .path
        .rsplit('/')
        .next()
        .unwrap_or(&query.path);
    let content_type = guess_content_type(&query.path);
    let disposition = format!("inline; filename=\"{filename}\"");

    Ok((
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, content_type),
            (header::CONTENT_DISPOSITION, disposition.as_str()),
        ],
        bytes,
    )
        .into_response())
}

async fn get_repo_archive(
    State(state): State<AppState>,
    OptionalAuth(auth): OptionalAuth,
    Path((org_path, repo_slug)): Path<(String, String)>,
    Query(query): Query<TreeQuery>,
) -> Result<Response, ApiError> {
    let (_org, _repo, repo_path) =
        load_repo_for_read(&state, &crate::org::org_path_from_param(&org_path), &repo_slug, auth.as_ref()).await?;
    let ref_kind = parse_ref_kind(&query.ref_kind)?;

    let bytes = explorer::create_archive(&repo_path, &query.r#ref, ref_kind)
        .await
        .map_err(map_explorer_error)?;

    let filename = format!("{repo_slug}-{ref}.zip", ref = query.r#ref);
    let disposition = format!("attachment; filename=\"{filename}\"");

    Ok((
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, "application/zip"),
            (header::CONTENT_DISPOSITION, disposition.as_str()),
        ],
        bytes,
    )
        .into_response())
}

async fn get_repo_tags(
    State(state): State<AppState>,
    OptionalAuth(auth): OptionalAuth,
    Path((org_path, repo_slug)): Path<(String, String)>,
) -> Result<Json<TagsResponse>, ApiError> {
    let (_org, _repo, repo_path) =
        load_repo_for_read(&state, &crate::org::org_path_from_param(&org_path), &repo_slug, auth.as_ref()).await?;

    let tags = explorer::list_tag_details(&repo_path)
        .await
        .map_err(map_explorer_error)?;

    Ok(Json(TagsResponse { tags }))
}

async fn get_repo_branches(
    State(state): State<AppState>,
    OptionalAuth(auth): OptionalAuth,
    Path((org_path, repo_slug)): Path<(String, String)>,
) -> Result<Json<BranchesResponse>, ApiError> {
    let (_org, _repo, repo_path) =
        load_repo_for_read(&state, &crate::org::org_path_from_param(&org_path), &repo_slug, auth.as_ref()).await?;

    let branches = explorer::list_branch_details(&repo_path)
        .await
        .map_err(map_explorer_error)?;

    Ok(Json(BranchesResponse { branches }))
}

async fn get_repo_commits(
    State(state): State<AppState>,
    OptionalAuth(auth): OptionalAuth,
    Path((org_path, repo_slug)): Path<(String, String)>,
    Query(query): Query<CommitsQuery>,
) -> Result<Json<CommitsResponse>, ApiError> {
    let (_org, _repo, repo_path) =
        load_repo_for_read(&state, &crate::org::org_path_from_param(&org_path), &repo_slug, auth.as_ref()).await?;
    let ref_kind = parse_ref_kind(&query.ref_kind)?;

    let commits = match explorer::list_commits(&repo_path, &query.r#ref, ref_kind, query.limit.min(100)).await
    {
        Ok(commits) => commits,
        Err(err) if is_missing_git_ref(&err) => Vec::new(),
        Err(err) => return Err(map_explorer_error(err)),
    };

    Ok(Json(CommitsResponse {
        commits,
        r#ref: query.r#ref,
    }))
}

async fn get_repo_commit(
    State(state): State<AppState>,
    OptionalAuth(auth): OptionalAuth,
    Path((org_path, repo_slug, commit_sha)): Path<(String, String, String)>,
) -> Result<Json<CommitResponse>, ApiError> {
    let (_org, _repo, repo_path) =
        load_repo_for_read(&state, &crate::org::org_path_from_param(&org_path), &repo_slug, auth.as_ref()).await?;

    let commit = explorer::get_commit(&repo_path, &commit_sha)
        .await
        .map_err(map_explorer_error)?;

    Ok(Json(CommitResponse { commit }))
}

#[derive(Clone, Debug)]
pub struct OptionalAuth(pub Option<AuthUser>);

impl<S> axum::extract::FromRequestParts<S> for OptionalAuth
where
    S: Send + Sync,
{
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut axum::http::request::Parts,
        _state: &S,
    ) -> Result<Self, Self::Rejection> {
        Ok(OptionalAuth(parts.extensions.get::<AuthUser>().cloned()))
    }
}

#[derive(Clone, Debug)]
pub struct AuthUser {
    pub user_id: Uuid,
    pub username: String,
}

fn token_from_download_query(query: Option<&str>) -> Option<String> {
    let query = query?;
    for pair in query.split('&') {
        let (key, value) = pair.split_once('=')?;
        if key == "access_token" {
            return urlencoding::decode(value).ok().map(|s| s.into_owned());
        }
    }
    None
}

fn extract_auth_token(
    headers: &axum::http::HeaderMap,
    path: &str,
    query: Option<&str>,
) -> Option<String> {
    if let Some(header_token) = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
    {
        return Some(header_token.to_string());
    }

    if path.ends_with("/download") {
        return token_from_download_query(query);
    }

    None
}

async fn authenticate_token(state: &AppState, token: &str) -> Result<AuthUser, ApiError> {
    if let Ok(claims) = verify_token(&state.config.jwt_secret, token) {
        admin::ensure_user_approved(&state.pool, claims.sub).await?;
        return Ok(AuthUser {
            user_id: claims.sub,
            username: claims.username,
        });
    }

    if let Some(api_auth) = api_tokens::authenticate_api_token(&state.pool, token)
        .await
        .map_err(|_| DomainError::Unauthorized)?
    {
        admin::ensure_user_approved(&state.pool, api_auth.user_id).await?;
        return Ok(AuthUser {
            user_id: api_auth.user_id,
            username: api_auth.username,
        });
    }

    Err(DomainError::Unauthorized.into())
}

async fn optional_auth_middleware(
    State(state): State<AppState>,
    mut req: Request<axum::body::Body>,
    next: Next,
) -> Response {
    let path = req.uri().path().to_string();
    let query = req.uri().query().map(str::to_string);
    if let Some(token) = extract_auth_token(req.headers(), &path, query.as_deref()) {
        if let Ok(auth) = authenticate_token(&state, &token).await {
            req.extensions_mut().insert(auth);
        }
    }

    next.run(req).await
}

fn is_auth_exempt_path(path: &str) -> bool {
    matches!(
        path,
        "/health" | "/health/live" | "/api/v1/health" | "/api/v1/health/live"
    ) || path.ends_with("/auth/register")
        || path.ends_with("/auth/login")
        || path.ends_with("/auth/registration")
        || path.ends_with("/auth/providers")
        || path.contains("/auth/oidc/")
        || path.ends_with("/auth/oidc/callback")
        || path.contains("/auth/saml/")
        || path.contains("/auth/ldap/")
}

async fn auth_middleware(
    State(state): State<AppState>,
    mut req: Request<axum::body::Body>,
    next: Next,
) -> Result<Response, ApiError> {
    let path = req.uri().path();
    let query = req.uri().query();

    if is_auth_exempt_path(path) {
        return Ok(next.run(req).await);
    }

    let token = extract_auth_token(req.headers(), path, query).ok_or(DomainError::Unauthorized)?;

    let auth = authenticate_token(&state, &token).await?;
    req.extensions_mut().insert(auth);

    Ok(next.run(req).await)
}

impl<S> axum::extract::FromRequestParts<S> for AuthUser
where
    S: Send + Sync,
{
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut axum::http::request::Parts,
        _state: &S,
    ) -> Result<Self, Self::Rejection> {
        parts
            .extensions
            .get::<AuthUser>()
            .cloned()
            .ok_or(DomainError::Unauthorized.into())
    }
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

pub struct ApiError(DomainError);

impl ApiError {
    pub fn user_message(&self) -> String {
        let raw = self.0.to_string();
        raw.strip_prefix("validation error: ")
            .unwrap_or(&raw)
            .to_string()
    }
}

impl From<DomainError> for ApiError {
    fn from(value: DomainError) -> Self {
        Self(value)
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let status = match self.0 {
            DomainError::NotFound => StatusCode::NOT_FOUND,
            DomainError::Unauthorized => StatusCode::UNAUTHORIZED,
            DomainError::Forbidden => StatusCode::FORBIDDEN,
            DomainError::Conflict(_) => StatusCode::CONFLICT,
            DomainError::Validation(_) => StatusCode::BAD_REQUEST,
            DomainError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };

        let message = self.0.to_string();
        observability::log_api_error(status, &message, "");
        (status, Json(ErrorBody { error: message })).into_response()
    }
}

#[cfg(test)]
mod lib_tests {
    use super::*;
    use axum::http::HeaderMap;

    #[test]
    fn is_auth_exempt_path_matches_public_routes() {
        assert!(is_auth_exempt_path("/api/v1/health"));
        assert!(is_auth_exempt_path("/api/v1/auth/login"));
        assert!(is_auth_exempt_path("/api/v1/auth/oidc/acme/callback"));
        assert!(!is_auth_exempt_path("/api/v1/me"));
    }

    #[test]
    fn extract_auth_token_from_bearer_header() {
        let mut headers = HeaderMap::new();
        headers.insert(
            header::AUTHORIZATION,
            "Bearer jwt-token".parse().unwrap(),
        );
        assert_eq!(
            extract_auth_token(&headers, "/api/v1/me", None).as_deref(),
            Some("jwt-token")
        );
    }

    #[test]
    fn extract_auth_token_from_download_query() {
        let headers = HeaderMap::new();
        assert_eq!(
            extract_auth_token(
                &headers,
                "/api/v1/artifacts/x/download",
                Some("access_token=dl-token")
            )
            .as_deref(),
            Some("dl-token")
        );
    }

    #[test]
    fn api_error_maps_status_codes() {
        let err = ApiError::from(DomainError::NotFound);
        let response = err.into_response();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }
}
