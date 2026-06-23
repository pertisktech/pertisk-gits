use std::sync::Arc;

use axum::{
    extract::{Path, Query, State},
    http::{header, Method, Request, StatusCode},
    middleware::{from_fn_with_state, Next},
    response::{Html, IntoResponse, Response},
    routing::{get, get_service, post},
    Json, Router,
};
use pertisk_domain::{
    auth::{create_token, verify_token},
    models::*,
    DomainError,
};
use pertisk_git::{
    access::{self, AuthUser as GitAuthUser, RepoRecord},
    config::repo_disk_path,
    explorer::{self, CommitDetail, CommitInfo, RefKind, RepoBrowser, TreeEntry},
    http::GitHttpState,
    ssh::{GitSshConfig, GitSshState},
    storage::{ensure_bare_repo, init_bare_repo},
    ssh_keys,
};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::{ServeDir, ServeFile};
use tower_http::trace::TraceLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};
use uuid::Uuid;
use validator::Validate;

mod config;
mod db;
mod password;

use config::Config;
use password::{hash_password, verify_password};

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub config: Arc<Config>,
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
}

#[derive(Serialize)]
struct MeResponse {
    user: UserPublic,
}

#[derive(Serialize)]
struct RepositoryResponse {
    repository: Repository,
    clone_url_http: String,
    clone_url_ssh: Option<String>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();

    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,pertisk_api=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    let config = Arc::new(Config::from_env()?);
    std::fs::create_dir_all(&config.repos_root)?;
    let pool = db::connect(&config.database_url).await?;
    sqlx::migrate!("../../migrations").run(&pool).await?;

    let state = AppState {
        pool,
        config: config.clone(),
    };

    let api_routes = Router::new()
        .route("/health", get(health))
        .route("/auth/register", post(register))
        .route("/auth/login", post(login))
        .route("/me", get(me))
        .route("/me/ssh-keys", get(list_ssh_keys).post(create_ssh_key))
        .route("/me/ssh-keys/{key_id}", axum::routing::delete(delete_ssh_key))
        .route("/organizations", get(list_organizations).post(create_organization))
        .route(
            "/organizations/{org_slug}/repositories",
            get(list_repositories).post(create_repository),
        )
        .route(
            "/organizations/{org_slug}/repositories/{repo_slug}",
            get(get_repository).patch(update_repository),
        )
        .route(
            "/organizations/{org_slug}/repositories/{repo_slug}/browser",
            get(get_repo_browser),
        )
        .route(
            "/organizations/{org_slug}/repositories/{repo_slug}/tree",
            get(get_repo_tree),
        )
        .route(
            "/organizations/{org_slug}/repositories/{repo_slug}/blob",
            get(get_repo_blob),
        )
        .route(
            "/organizations/{org_slug}/repositories/{repo_slug}/raw",
            get(get_repo_raw),
        )
        .route(
            "/organizations/{org_slug}/repositories/{repo_slug}/commits",
            get(get_repo_commits),
        )
        .route(
            "/organizations/{org_slug}/repositories/{repo_slug}/commits/{commit_sha}",
            get(get_repo_commit),
        )
        .layer(from_fn_with_state(state.clone(), auth_middleware));

    let git_state = GitHttpState {
        pool: state.pool.clone(),
        repos_root: state.config.repos_root.clone(),
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
        });

        tokio::spawn(async move {
            if let Err(err) = pertisk_git::ssh::run_server(ssh_state).await {
                tracing::error!("git ssh server failed: {err:#}");
            }
        });
    }

    let mut app = Router::new()
        .route("/health", get(health))
        .route("/health/live", get(health_live))
        .nest("/api/v1", api_routes)
        .merge(pertisk_git::http::router().with_state(git_state));

    if let Some(web_dist) = &config.web_dist {
        let index = web_dist.join("index.html");
        if !index.is_file() {
            anyhow::bail!(
                "WEB_DIST={} but index.html is missing — run `cd web && npm run build` first",
                web_dist.display()
            );
        }
        app = app
            .nest_service("/assets", ServeDir::new(web_dist.join("assets")))
            .route_service("/favicon.svg", get_service(ServeFile::new(web_dist.join("favicon.svg"))))
            .route_service("/icons.svg", get_service(ServeFile::new(web_dist.join("icons.svg"))))
            .fallback(get(spa_index));
        tracing::info!("serving web UI from {}", web_dist.display());
    } else {
        app = app.route("/", get(root));
    }

    let app = app
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods(Any)
                .allow_headers(Any),
        )
        .layer(TraceLayer::new_for_http())
        .with_state(state.clone());

    let addr = format!("{}:{}", config.host, config.port);
    tracing::info!("pertisk-api listening on {addr}");

    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

async fn root() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "service": "pertisk-api",
        "version": env!("CARGO_PKG_VERSION"),
        "note": "This is the REST API. Open the web UI at http://localhost:5173",
        "health": "/health",
        "health_live": "/health/live",
        "api_health": "/api/v1/health",
        "api_base": "/api/v1"
    }))
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
            version: env!("CARGO_PKG_VERSION"),
            database,
        }),
    )
}

async fn health_live() -> (StatusCode, &'static str) {
    (StatusCode::OK, "ok")
}

async fn register(
    State(state): State<AppState>,
    Json(body): Json<RegisterRequest>,
) -> Result<Json<AuthResponse>, ApiError> {
    body.validate()
        .map_err(|e| ApiError::from(DomainError::Validation(e.to_string())))?;

    let password_hash = hash_password(&body.password)
        .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    let user = sqlx::query_as::<_, User>(
        r#"
        INSERT INTO users (username, email, password_hash, display_name)
        VALUES ($1, $2, $3, $4)
        RETURNING id, username, email, password_hash, display_name, created_at, updated_at
        "#,
    )
    .bind(&body.username)
    .bind(&body.email)
    .bind(&password_hash)
    .bind(&body.display_name)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| match e {
        sqlx::Error::Database(db) if db.constraint().is_some() => {
            ApiError::from(DomainError::Conflict("username or email already exists".into()))
        }
        other => ApiError::from(DomainError::Internal(other.to_string())),
    })?;

    let token = create_token(user.id, &user.username, &state.config.jwt_secret, 72)
        .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    Ok(Json(AuthResponse {
        token,
        user: user.into_public(),
    }))
}

async fn login(
    State(state): State<AppState>,
    Json(body): Json<LoginRequest>,
) -> Result<Json<AuthResponse>, ApiError> {
    body.validate()
        .map_err(|e| ApiError::from(DomainError::Validation(e.to_string())))?;

    let user = sqlx::query_as::<_, User>(
        r#"
        SELECT id, username, email, password_hash, display_name, created_at, updated_at
        FROM users
        WHERE username = $1 OR email = $1
        "#,
    )
    .bind(&body.login)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?
    .ok_or(DomainError::Unauthorized)?;

    let valid = verify_password(&body.password, &user.password_hash)
        .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    if !valid {
        return Err(DomainError::Unauthorized.into());
    }

    let token = create_token(user.id, &user.username, &state.config.jwt_secret, 72)
        .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    Ok(Json(AuthResponse {
        token,
        user: user.into_public(),
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

    Ok(Json(MeResponse { user }))
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
) -> Result<Json<Vec<Organization>>, ApiError> {
    let orgs = sqlx::query_as::<_, Organization>(
        r#"
        SELECT o.id, o.slug, o.name, o.description, o.created_at, o.updated_at
        FROM organizations o
        INNER JOIN organization_members m ON m.organization_id = o.id
        WHERE m.user_id = $1
        ORDER BY o.name
        "#,
    )
    .bind(auth.user_id)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    Ok(Json(orgs))
}

async fn create_organization(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(body): Json<CreateOrganizationRequest>,
) -> Result<(StatusCode, Json<Organization>), ApiError> {
    body.validate()
        .map_err(|e| ApiError::from(DomainError::Validation(e.to_string())))?;

    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    let org = sqlx::query_as::<_, Organization>(
        r#"
        INSERT INTO organizations (slug, name, description)
        VALUES ($1, $2, $3)
        RETURNING id, slug, name, description, created_at, updated_at
        "#,
    )
    .bind(&body.slug)
    .bind(&body.name)
    .bind(&body.description)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| match e {
        sqlx::Error::Database(db) if db.constraint().is_some() => {
            ApiError::from(DomainError::Conflict("organization slug already exists".into()))
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

async fn list_repositories(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(org_slug): Path<String>,
) -> Result<Json<Vec<Repository>>, ApiError> {
    let org = find_org_for_member(&state.pool, &org_slug, auth.user_id).await?;

    let repos = sqlx::query_as::<_, Repository>(
        r#"
        SELECT id, organization_id, name, slug, description, visibility, default_branch, created_at, updated_at
        FROM repositories
        WHERE organization_id = $1
        ORDER BY name
        "#,
    )
    .bind(org.id)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    Ok(Json(repos))
}

async fn create_repository(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(org_slug): Path<String>,
    Json(body): Json<CreateRepositoryRequest>,
) -> Result<(StatusCode, Json<Repository>), ApiError> {
    body.validate()
        .map_err(|e| ApiError::from(DomainError::Validation(e.to_string())))?;

    let org = find_org_for_member(&state.pool, &org_slug, auth.user_id).await?;
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
        RETURNING id, organization_id, name, slug, description, visibility, default_branch, created_at, updated_at
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

    init_bare_repo(&state.config.repos_root, &org_slug, &repo.slug)
        .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    Ok((StatusCode::CREATED, Json(repo)))
}

async fn get_repository(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_slug, repo_slug)): Path<(String, String)>,
) -> Result<Json<RepositoryResponse>, ApiError> {
    let org = find_org_for_member(&state.pool, &org_slug, auth.user_id).await?;

    let repo = sqlx::query_as::<_, Repository>(
        r#"
        SELECT id, organization_id, name, slug, description, visibility, default_branch, created_at, updated_at
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

    ensure_bare_repo(&state.config.repos_root, &org_slug, &repo.slug)
        .await
        .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    Ok(Json(repo_response(&state.config, &org_slug, repo)))
}

async fn update_repository(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_slug, repo_slug)): Path<(String, String)>,
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

    let org = find_org_for_member(&state.pool, &org_slug, auth.user_id).await?;

    let repo = sqlx::query_as::<_, Repository>(
        r#"
        SELECT id, organization_id, name, slug, description, visibility, default_branch, created_at, updated_at
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

    ensure_can_write_repo(&state, &org_slug, &repo, &auth).await?;

    if let Some(default_branch) = &body.default_branch {
        let repo_path = repo_disk_path(&state.config.repos_root, &org_slug, &repo.slug);
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
        RETURNING id, organization_id, name, slug, description, visibility, default_branch, created_at, updated_at
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

    Ok(Json(repo_response(&state.config, &org_slug, updated)))
}

async fn ensure_can_write_repo(
    state: &AppState,
    org_slug: &str,
    repo: &Repository,
    auth: &AuthUser,
) -> Result<(), ApiError> {
    let record = RepoRecord {
        id: repo.id,
        org_slug: org_slug.to_string(),
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
struct CommitsResponse {
    commits: Vec<CommitInfo>,
    r#ref: String,
}

#[derive(Serialize)]
struct CommitResponse {
    commit: CommitDetail,
}

async fn load_repo(
    state: &AppState,
    org_slug: &str,
    repo_slug: &str,
    user_id: Uuid,
) -> Result<(Organization, Repository, std::path::PathBuf), ApiError> {
    let org = find_org_for_member(&state.pool, org_slug, user_id).await?;

    let repo = sqlx::query_as::<_, Repository>(
        r#"
        SELECT id, organization_id, name, slug, description, visibility, default_branch, created_at, updated_at
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

    ensure_bare_repo(&state.config.repos_root, org_slug, &repo.slug)
        .await
        .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    let repo_path = repo_disk_path(&state.config.repos_root, org_slug, &repo.slug);
    Ok((org, repo, repo_path))
}

fn map_explorer_error(err: anyhow::Error) -> ApiError {
    let msg = err.to_string().to_lowercase();
    if msg.contains("not found") || msg.contains("unknown revision") || msg.contains("bad revision") {
        ApiError::from(DomainError::NotFound)
    } else {
        ApiError::from(DomainError::Internal(err.to_string()))
    }
}

async fn get_repo_browser(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_slug, repo_slug)): Path<(String, String)>,
) -> Result<Json<BrowserResponse>, ApiError> {
    let (_org, repo, repo_path) = load_repo(&state, &org_slug, &repo_slug, auth.user_id).await?;

    let browser = explorer::repo_browser(&repo_path, &repo.default_branch)
        .await
        .map_err(map_explorer_error)?;

    Ok(Json(BrowserResponse { browser }))
}

async fn get_repo_tree(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_slug, repo_slug)): Path<(String, String)>,
    Query(query): Query<TreeQuery>,
) -> Result<Json<TreeResponse>, ApiError> {
    let (_org, _repo, repo_path) = load_repo(&state, &org_slug, &repo_slug, auth.user_id).await?;
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

async fn get_repo_blob(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_slug, repo_slug)): Path<(String, String)>,
    Query(query): Query<BlobQuery>,
) -> Result<Json<BlobResponse>, ApiError> {
    if query.path.is_empty() {
        return Err(DomainError::Validation("path is required".into()).into());
    }

    let (_org, _repo, repo_path) = load_repo(&state, &org_slug, &repo_slug, auth.user_id).await?;
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
    auth: AuthUser,
    Path((org_slug, repo_slug)): Path<(String, String)>,
    Query(query): Query<BlobQuery>,
) -> Result<Response, ApiError> {
    if query.path.is_empty() {
        return Err(DomainError::Validation("path is required".into()).into());
    }

    let (_org, _repo, repo_path) = load_repo(&state, &org_slug, &repo_slug, auth.user_id).await?;
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

async fn get_repo_commits(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_slug, repo_slug)): Path<(String, String)>,
    Query(query): Query<CommitsQuery>,
) -> Result<Json<CommitsResponse>, ApiError> {
    let (_org, _repo, repo_path) = load_repo(&state, &org_slug, &repo_slug, auth.user_id).await?;
    let ref_kind = parse_ref_kind(&query.ref_kind)?;

    let commits = explorer::list_commits(&repo_path, &query.r#ref, ref_kind, query.limit.min(100))
        .await
        .map_err(map_explorer_error)?;

    Ok(Json(CommitsResponse {
        commits,
        r#ref: query.r#ref,
    }))
}

async fn get_repo_commit(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_slug, repo_slug, commit_sha)): Path<(String, String, String)>,
) -> Result<Json<CommitResponse>, ApiError> {
    let (_org, _repo, repo_path) = load_repo(&state, &org_slug, &repo_slug, auth.user_id).await?;

    let commit = explorer::get_commit(&repo_path, &commit_sha)
        .await
        .map_err(map_explorer_error)?;

    Ok(Json(CommitResponse { commit }))
}

async fn find_org_for_member(
    pool: &PgPool,
    org_slug: &str,
    user_id: Uuid,
) -> Result<Organization, ApiError> {
    sqlx::query_as::<_, Organization>(
        r#"
        SELECT o.id, o.slug, o.name, o.description, o.created_at, o.updated_at
        FROM organizations o
        INNER JOIN organization_members m ON m.organization_id = o.id
        WHERE o.slug = $1 AND m.user_id = $2
        "#,
    )
    .bind(org_slug)
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?
    .ok_or(DomainError::Forbidden.into())
}

#[derive(Clone, Debug)]
pub struct AuthUser {
    pub user_id: Uuid,
    pub username: String,
}

async fn auth_middleware(
    State(state): State<AppState>,
    mut req: Request<axum::body::Body>,
    next: Next,
) -> Result<Response, ApiError> {
    let path = req.uri().path();

    if path.ends_with("/health")
        || path.ends_with("/health/live")
        || path.ends_with("/auth/register")
        || path.ends_with("/auth/login")
    {
        return Ok(next.run(req).await);
    }

    let token = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .ok_or(DomainError::Unauthorized)?;

    let claims = verify_token(&state.config.jwt_secret, token)
        .map_err(|_| DomainError::Unauthorized)?;

    req.extensions_mut().insert(AuthUser {
        user_id: claims.sub,
        username: claims.username,
    });

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
        (status, Json(ErrorBody { error: message })).into_response()
    }
}
