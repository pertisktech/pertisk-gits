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
    config::repo_disk_path,
    explorer::{self, CommitInfo, RepoBrowser, TreeEntry},
    http::GitHttpState,
    storage::{ensure_bare_repo, init_bare_repo},
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
        .route("/organizations", get(list_organizations).post(create_organization))
        .route(
            "/organizations/{org_slug}/repositories",
            get(list_repositories).post(create_repository),
        )
        .route(
            "/organizations/{org_slug}/repositories/{repo_slug}",
            get(get_repository),
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
            "/organizations/{org_slug}/repositories/{repo_slug}/commits",
            get(get_repo_commits),
        )
        .layer(from_fn_with_state(state.clone(), auth_middleware));

    let git_state = GitHttpState {
        pool: state.pool.clone(),
        repos_root: state.config.repos_root.clone(),
    };

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

    Ok(Json(RepositoryResponse {
        clone_url_http: state.config.clone_url(&org_slug, &repo.slug),
        repository: repo,
    }))
}

#[derive(Deserialize)]
struct TreeQuery {
    #[serde(default = "default_ref")]
    r#ref: String,
    #[serde(default)]
    path: String,
}

fn default_ref() -> String {
    "main".into()
}

#[derive(Deserialize)]
struct BlobQuery {
    #[serde(default = "default_ref")]
    r#ref: String,
    path: String,
}

#[derive(Deserialize)]
struct CommitsQuery {
    #[serde(default = "default_ref")]
    r#ref: String,
    #[serde(default = "default_commit_limit")]
    limit: u32,
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

    let entries = explorer::list_tree(&repo_path, &query.r#ref, &query.path)
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

    let content = explorer::read_blob(&repo_path, &query.r#ref, &query.path)
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

async fn get_repo_commits(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_slug, repo_slug)): Path<(String, String)>,
    Query(query): Query<CommitsQuery>,
) -> Result<Json<CommitsResponse>, ApiError> {
    let (_org, _repo, repo_path) = load_repo(&state, &org_slug, &repo_slug, auth.user_id).await?;

    let commits = explorer::list_commits(&repo_path, &query.r#ref, query.limit.min(100))
        .await
        .map_err(map_explorer_error)?;

    Ok(Json(CommitsResponse {
        commits,
        r#ref: query.r#ref,
    }))
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
