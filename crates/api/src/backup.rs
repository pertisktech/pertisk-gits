use std::io;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};

use axum::{
    body::Body,
    extract::{DefaultBodyLimit, Multipart, Path as AxumPath, State},
    http::{header, StatusCode},
    response::Response,
    routing::{get, post},
    Json, Router,
};
use chrono::{DateTime, Utc};
use flate2::write::GzEncoder;
use flate2::Compression;
use pertisk_domain::DomainError;
use pertisk_registry::storage::{registry_uses_s3_storage, StorageBackend};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use tar::{Archive, Builder};
use tokio::io::AsyncWriteExt;
use tokio_util::io::ReaderStream;
use uuid::Uuid;
use validator::Validate;

use crate::admin::{self, artifacts_root, registry_root, repos_root};
use pertisk_git::storage::repair_all_bare_repo_refs_dirs;
use crate::system_metrics;
use crate::{ApiError, AppState, AuthUser};
use crate::version;

const BACKUP_FORMAT_VERSION: u32 = 1;
const BACKUP_COMPONENT_MARKER: &str = ".pertisk-backup-component.json";

fn backup_restore_max_upload_bytes() -> usize {
    std::env::var("BACKUP_RESTORE_MAX_UPLOAD_BYTES")
        .ok()
        .and_then(|value| value.trim().parse::<usize>().ok())
        .filter(|value| *value >= 1024 * 1024)
        .unwrap_or(pertisk_registry::MAX_REGISTRY_BODY_BYTES)
}

#[derive(Debug, Serialize, Deserialize)]
struct BackupComponentMarker {
    component: String,
    entry_count: u64,
}

fn is_backup_component_marker(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name == BACKUP_COMPONENT_MARKER)
}

async fn write_backup_component_marker(
    dest: &Path,
    component: &str,
    entry_count: u64,
) -> anyhow::Result<()> {
    tokio::fs::create_dir_all(dest).await?;
    let marker = BackupComponentMarker {
        component: component.to_string(),
        entry_count,
    };
    tokio::fs::write(
        dest.join(BACKUP_COMPONENT_MARKER),
        serde_json::to_string(&marker)?,
    )
    .await?;
    Ok(())
}

fn count_backup_data_files(dir: &Path) -> anyhow::Result<u64> {
    if !dir.exists() {
        return Ok(0);
    }
    Ok(walkdir(dir)?
        .into_iter()
        .filter(|path| !is_backup_component_marker(path))
        .count() as u64)
}

fn pg_tool_path(tool: &str) -> PathBuf {
    let env_key = match tool {
        "pg_dump" => "PG_DUMP_PATH",
        "pg_restore" => "PG_RESTORE_PATH",
        "psql" => "PSQL_PATH",
        _ => "PG_TOOL_PATH",
    };
    if let Ok(path) = std::env::var(env_key) {
        return PathBuf::from(path);
    }
    PathBuf::from(tool)
}

fn pg_tool_missing_error(tool: &str, program: &Path) -> anyhow::Error {
    let env_hint = match tool {
        "pg_dump" => "PG_DUMP_PATH",
        "pg_restore" => "PG_RESTORE_PATH",
        "psql" => "PSQL_PATH",
        _ => "PG_TOOL_PATH",
    };
    anyhow::anyhow!(
        "{tool} not found at {}. Install PostgreSQL client tools \
         (Alpine/Debian: postgresql-client, RHEL/AlmaLinux: postgresql) \
         or set {env_hint}.",
        program.display()
    )
}

fn run_pg_tool(tool: &str, args: &[&str]) -> anyhow::Result<Output> {
    run_pg_tool_with_stdio(tool, None, args, Stdio::null())
}

fn run_pg_tool_with_stdio(
    tool: &str,
    database_url: Option<&str>,
    args: &[&str],
    stdout: Stdio,
) -> anyhow::Result<Output> {
    let program = pg_tool_path(tool);
    let mut cmd = Command::new(&program);
    if let Some(url) = database_url {
        let conn = pg_connection_info(url)?;
        apply_pg_env(&mut cmd, &conn);
    }
    cmd.args(args).stdout(stdout).stderr(Stdio::piped());
    cmd.output().map_err(|error| {
        if error.kind() == io::ErrorKind::NotFound {
            pg_tool_missing_error(tool, &program)
        } else {
            error.into()
        }
    })
}

#[derive(Debug, Clone)]
struct PgConnectionInfo {
    database: String,
    host: String,
    port: String,
    user: String,
    password: Option<String>,
    sslmode: Option<String>,
}

fn pg_connection_info(database_url: &str) -> anyhow::Result<PgConnectionInfo> {
    let url = reqwest::Url::parse(database_url)
        .map_err(|error| anyhow::anyhow!("invalid DATABASE_URL: {error}"))?;
    let host = url
        .host_str()
        .ok_or_else(|| anyhow::anyhow!("DATABASE_URL missing host"))?
        .to_string();
    let port = url.port().unwrap_or(5432).to_string();
    let database = url.path().trim_start_matches('/');
    if database.is_empty() {
        anyhow::bail!("DATABASE_URL missing database name");
    }
    let sslmode = url
        .query_pairs()
        .find(|(key, _)| key == "sslmode")
        .map(|(_, value)| value.into_owned());
    Ok(PgConnectionInfo {
        database: database.to_string(),
        host,
        port,
        user: url.username().to_string(),
        password: url.password().map(str::to_string),
        sslmode,
    })
}

fn apply_pg_env(cmd: &mut Command, conn: &PgConnectionInfo) {
    cmd.env("PGHOST", &conn.host);
    cmd.env("PGPORT", &conn.port);
    cmd.env("PGDATABASE", &conn.database);
    if !conn.user.is_empty() {
        cmd.env("PGUSER", &conn.user);
    }
    if let Some(password) = &conn.password {
        cmd.env("PGPASSWORD", password);
    }
    if let Some(sslmode) = &conn.sslmode {
        cmd.env("PGSSLMODE", sslmode);
    }
}

async fn database_size_bytes(pool: &PgPool) -> anyhow::Result<i64> {
    sqlx::query_scalar("SELECT pg_database_size(current_database())")
        .fetch_one(pool)
        .await
        .map_err(Into::into)
}

async fn validate_db_dump(
    pool: &PgPool,
    database_url: &str,
    dump_path: &Path,
) -> anyhow::Result<u64> {
    let dump_size = tokio::fs::metadata(dump_path).await?.len();
    if dump_size < 4_096 {
        anyhow::bail!(
            "database dump is only {dump_size} bytes — pg_dump likely connected to the wrong \
             database or client tools are misconfigured (check DATABASE_URL and PG_DUMP_PATH)"
        );
    }

    let db_size = database_size_bytes(pool).await?;
    if db_size > 1_000_000 && dump_size < 32_768 {
        let conn = pg_connection_info(database_url)
            .map(|info| format!("{}:{}/{}", info.host, info.port, info.database))
            .unwrap_or_else(|_| "could not parse DATABASE_URL".into());
        anyhow::bail!(
            "database is {:.1} MiB on disk but pg_dump produced only {} bytes. \
             pg_dump may not be connecting to the same server as the API ({conn}). \
             Set PG_DUMP_PATH to the PostgreSQL client matching your server and verify \
             DATABASE_URL host/port/database.",
            db_size as f64 / (1024.0 * 1024.0),
            dump_size
        );
    }

    Ok(dump_size)
}

fn pg_tool_version(tool: &str) -> Option<String> {
    let output = run_pg_tool(tool, &["--version"]).ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let line = if !stdout.trim().is_empty() {
        stdout.trim()
    } else {
        stderr.trim()
    };
    if line.is_empty() {
        None
    } else {
        Some(line.to_string())
    }
}

fn is_custom_pg_dump(path: &Path) -> anyhow::Result<bool> {
    let mut header = [0_u8; 5];
    let mut file = std::fs::File::open(path)?;
    use std::io::Read;
    let read = file.read(&mut header)?;
    Ok(read >= 5 && &header == b"PGDMP")
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DbDumpFormat {
    PlainSql,
    Custom,
}

fn resolve_db_dump_path(extract_dir: &Path) -> Option<PathBuf> {
    for name in ["db.sql", "db.dump"] {
        let path = extract_dir.join(name);
        if path.is_file() {
            return Some(path);
        }
    }
    None
}

fn pg_restore_version_mismatch(stderr: &str) -> Option<String> {
    if !stderr.contains("unsupported version") {
        return None;
    }
    let pg_restore_ver = pg_tool_version("pg_restore").unwrap_or_else(|| "unknown".into());
    Some(format!(
        "pg_restore ({pg_restore_ver}) is older than the backup's pg_dump format. \
         Install PostgreSQL client tools matching the server that created the backup \
         (e.g. PostgreSQL 17 for format 1.16), set PG_RESTORE_PATH to that pg_restore, \
         or create a new backup after upgrading — new backups use plain SQL and restore with psql."
    ))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BackupComponent {
    Db,
    Repos,
    Registry,
    Artifacts,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BackupJobStatus {
    Pending,
    Running,
    Completed,
    Failed,
}

#[derive(Debug, Serialize, Deserialize)]
struct BackupManifest {
    version: u32,
    app_version: String,
    created_at: DateTime<Utc>,
    components: Vec<BackupComponent>,
    registry_storage: String,
    /// `plain` (SQL) or `custom` (pg_dump -Fc). Omitted in older archives.
    db_format: Option<String>,
    pg_client_version: Option<String>,
    db_size_bytes: Option<u64>,
    db_dump_bytes: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct BackupJobMeta {
    id: Uuid,
    status: BackupJobStatus,
    components: Vec<BackupComponent>,
    created_at: DateTime<Utc>,
    completed_at: Option<DateTime<Utc>>,
    error: Option<String>,
    archive_size_bytes: Option<u64>,
    /// Uncompressed `db.sql` / `db.dump` size when the database was included.
    db_dump_bytes: Option<u64>,
    /// File count under `repos/` when git repositories were included.
    repos_entry_count: Option<u64>,
    created_by: Option<Uuid>,
}

#[derive(Debug, Deserialize, Validate)]
struct CreateBackupRequest {
    #[validate(length(min = 1))]
    components: Vec<BackupComponent>,
}

#[derive(Serialize)]
struct BackupOverviewComponent {
    id: BackupComponent,
    label: String,
    available: bool,
    size_bytes: u64,
    storage: String,
    path: String,
}

#[derive(Serialize)]
struct BackupOverviewResponse {
    backups_root: String,
    registry_storage: String,
    components: Vec<BackupOverviewComponent>,
}

#[derive(Serialize)]
struct BackupJobResponse {
    id: Uuid,
    status: BackupJobStatus,
    components: Vec<BackupComponent>,
    created_at: DateTime<Utc>,
    completed_at: Option<DateTime<Utc>>,
    error: Option<String>,
    archive_size_bytes: Option<u64>,
    db_dump_bytes: Option<u64>,
    repos_entry_count: Option<u64>,
    /// Set when a database restore schedules a process restart for a fresh connection pool.
    #[serde(skip_serializing_if = "Option::is_none")]
    service_restart_scheduled: Option<bool>,
}

pub fn backup_routes() -> Router<AppState> {
    Router::new()
        .route("/admin/backups/overview", get(backup_overview))
        .route("/admin/backups", get(list_backups).post(create_backup))
        .route(
            "/admin/backups/{backup_id}",
            get(get_backup).delete(delete_backup),
        )
        .route("/admin/backups/{backup_id}/download", get(download_backup))
        .route("/admin/backups/restore", post(restore_backup))
        .layer(DefaultBodyLimit::max(backup_restore_max_upload_bytes()))
}

fn backups_root() -> PathBuf {
    PathBuf::from(
        std::env::var("BACKUPS_ROOT").unwrap_or_else(|_| "data/backups".into()),
    )
}

fn backup_dir(id: Uuid) -> PathBuf {
    backups_root().join(id.to_string())
}

fn backup_archive_path(id: Uuid) -> PathBuf {
    backup_dir(id).join("backup.tar.gz")
}

fn backup_meta_path(id: Uuid) -> PathBuf {
    backup_dir(id).join("meta.json")
}

async fn ensure_backups_root() -> Result<PathBuf, ApiError> {
    let root = backups_root();
    tokio::fs::create_dir_all(&root)
        .await
        .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;
    Ok(root)
}

fn to_job_response(meta: BackupJobMeta) -> BackupJobResponse {
    to_job_response_with_flags(meta, None)
}

fn to_job_response_with_flags(
    meta: BackupJobMeta,
    service_restart_scheduled: Option<bool>,
) -> BackupJobResponse {
    BackupJobResponse {
        id: meta.id,
        status: meta.status,
        components: meta.components,
        created_at: meta.created_at,
        completed_at: meta.completed_at,
        error: meta.error,
        archive_size_bytes: meta.archive_size_bytes,
        db_dump_bytes: meta.db_dump_bytes,
        repos_entry_count: meta.repos_entry_count,
        service_restart_scheduled,
    }
}

async fn read_meta(id: Uuid) -> Result<BackupJobMeta, ApiError> {
    let path = backup_meta_path(id);
    let raw = tokio::fs::read_to_string(&path)
        .await
        .map_err(|_| DomainError::NotFound)?;
    serde_json::from_str(&raw).map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))
}

async fn write_meta(meta: &BackupJobMeta) -> Result<(), ApiError> {
    let dir = backup_dir(meta.id);
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;
    let raw = serde_json::to_string_pretty(meta)
        .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;
    tokio::fs::write(backup_meta_path(meta.id), raw)
        .await
        .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))
}

async fn backup_overview(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<BackupOverviewResponse>, ApiError> {
    admin::ensure_super_admin(&state.pool, auth.user_id).await?;

    let registry_path = registry_root();
    let artifacts_path = artifacts_root();
    let registry_storage: String = if registry_uses_s3_storage() {
        "s3".into()
    } else {
        "local".into()
    };

    let db_size: i64 = sqlx::query_scalar("SELECT pg_database_size(current_database())")
        .fetch_one(&state.pool)
        .await
        .unwrap_or(0);

    let registry_disk = if registry_uses_s3_storage() {
        sqlx::query_scalar::<_, i64>("SELECT COALESCE(SUM(size_bytes), 0)::BIGINT FROM container_blobs")
            .fetch_one(&state.pool)
            .await
            .unwrap_or(0) as u64
    } else {
        let path = PathBuf::from(&registry_path).join("blobs");
        tokio::task::spawn_blocking(move || system_metrics::directory_size_bytes(&path))
            .await
            .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?
    };

    let artifacts_path_buf = PathBuf::from(&artifacts_path);
    let artifacts_disk = tokio::task::spawn_blocking({
        let path = artifacts_path_buf.clone();
        move || system_metrics::directory_size_bytes(&path)
    })
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    let repos_path = repos_root();
    let repos_path_buf = PathBuf::from(&repos_path);
    let repos_disk = tokio::task::spawn_blocking({
        let path = repos_path_buf.clone();
        move || system_metrics::directory_size_bytes(&path)
    })
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    Ok(Json(BackupOverviewResponse {
        backups_root: backups_root().display().to_string(),
        registry_storage: registry_storage.clone(),
        components: vec![
            BackupOverviewComponent {
                id: BackupComponent::Db,
                label: "Database".into(),
                available: true,
                size_bytes: db_size.max(0) as u64,
                storage: "postgresql".into(),
                path: "DATABASE_URL".into(),
            },
            BackupOverviewComponent {
                id: BackupComponent::Repos,
                label: "Git repositories".into(),
                available: true,
                size_bytes: repos_disk,
                storage: "local".into(),
                path: repos_path,
            },
            BackupOverviewComponent {
                id: BackupComponent::Registry,
                label: "Container registry".into(),
                available: true,
                size_bytes: registry_disk,
                storage: registry_storage,
                path: registry_path,
            },
            BackupOverviewComponent {
                id: BackupComponent::Artifacts,
                label: "CI artifacts".into(),
                available: true,
                size_bytes: artifacts_disk,
                storage: "local".into(),
                path: artifacts_path,
            },
        ],
    }))
}

async fn list_backups(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<Vec<BackupJobResponse>>, ApiError> {
    admin::ensure_super_admin(&state.pool, auth.user_id).await?;
    ensure_backups_root().await?;

    let mut jobs = Vec::new();
    let mut entries = tokio::fs::read_dir(backups_root())
        .await
        .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?
    {
        if !entry.file_type().await.map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let name = entry.file_name();
        let Ok(id) = Uuid::parse_str(name.to_string_lossy().as_ref()) else {
            continue;
        };
        if let Ok(meta) = read_meta(id).await {
            jobs.push(to_job_response(meta));
        }
    }

    jobs.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(Json(jobs))
}

async fn get_backup(
    State(state): State<AppState>,
    auth: AuthUser,
    AxumPath(backup_id): AxumPath<Uuid>,
) -> Result<Json<BackupJobResponse>, ApiError> {
    admin::ensure_super_admin(&state.pool, auth.user_id).await?;
    let meta = read_meta(backup_id).await?;
    Ok(Json(to_job_response(meta)))
}

async fn create_backup(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(body): Json<CreateBackupRequest>,
) -> Result<(StatusCode, Json<BackupJobResponse>), ApiError> {
    body.validate()
        .map_err(|e| ApiError::from(DomainError::Validation(e.to_string())))?;
    admin::ensure_super_admin(&state.pool, auth.user_id).await?;
    ensure_backups_root().await?;

    if body.components.is_empty() {
        return Err(DomainError::Validation("select at least one component".into()).into());
    }

    let id = Uuid::new_v4();
    let meta = BackupJobMeta {
        id,
        status: BackupJobStatus::Pending,
        components: body.components.clone(),
        created_at: Utc::now(),
        completed_at: None,
        error: None,
        archive_size_bytes: None,
        db_dump_bytes: None,
        repos_entry_count: None,
        created_by: Some(auth.user_id),
    };
    write_meta(&meta).await?;

    let pool = state.pool.clone();
    let database_url = state.config.database_url.clone();
    let components = body.components;
    tokio::spawn(async move {
        if let Err(error) = run_backup_job(id, pool, database_url, components).await {
            tracing::error!(%id, %error, "backup job failed");
            if let Ok(mut meta) = read_meta(id).await {
                meta.status = BackupJobStatus::Failed;
                meta.error = Some(error);
                meta.completed_at = Some(Utc::now());
                let _ = write_meta(&meta).await;
            }
        }
    });

    Ok((StatusCode::ACCEPTED, Json(to_job_response(meta))))
}

async fn run_backup_job(
    id: Uuid,
    pool: PgPool,
    database_url: String,
    components: Vec<BackupComponent>,
) -> Result<(), String> {
    let mut meta = match read_meta(id).await {
        Ok(meta) => meta,
        Err(_) => return Err("failed to read backup metadata".into()),
    };
    meta.status = BackupJobStatus::Running;
    if write_meta(&meta).await.is_err() {
        return Err("failed to update backup metadata".into());
    }

    let work = backup_dir(id).join("work");
    if work.exists() {
        tokio::fs::remove_dir_all(&work)
            .await
            .map_err(|e| e.to_string())?;
    }
    tokio::fs::create_dir_all(&work)
        .await
        .map_err(|e| e.to_string())?;

    let registry_storage = if registry_uses_s3_storage() {
        "s3".to_string()
    } else {
        "local".to_string()
    };

    let mut db_dump_bytes: Option<u64> = None;
    let mut repos_entry_count: Option<u64> = None;
    let db_size_bytes = if components.contains(&BackupComponent::Db) {
        database_size_bytes(&pool).await.ok().map(|size| size.max(0) as u64)
    } else {
        None
    };

    for component in &components {
        match component {
            BackupComponent::Db => {
                let dump_path = work.join("db.sql");
                backup_db(&database_url, &dump_path)
                    .await
                    .map_err(|e| format!("database backup failed: {e:#}"))?;
                db_dump_bytes = Some(
                    validate_db_dump(&pool, &database_url, &dump_path)
                        .await
                        .map_err(|e| format!("database backup failed: {e:#}"))?,
                );
            }
            BackupComponent::Registry => backup_registry(&pool, &work.join("registry"))
                .await
                .map_err(|e| format!("registry backup failed: {e:#}"))?,
            BackupComponent::Repos => {
                let repos_dest = work.join("repos");
                backup_repos(&repos_dest)
                    .await
                    .map_err(|e| format!("repositories backup failed: {e:#}"))?;
                let entry_count = count_backup_data_files(&repos_dest)
                    .map_err(|e| format!("repositories backup failed: {e:#}"))?;
                if entry_count == 0 {
                    let root = repos_root();
                    return Err(format!(
                        "repositories backup is empty — no git files under {root}. \
                         Verify REPOS_ROOT in pertisk-gits.conf (Admin overview should show \
                         Git repositories size > 0) before including this component."
                    ));
                }
                repos_entry_count = Some(entry_count);
                let repaired = repair_all_bare_repo_refs_dirs(&repos_dest)
                    .map_err(|e| format!("repositories backup failed: {e:#}"))?;
                if repaired > 0 {
                    tracing::info!(
                        repaired,
                        "ensured refs/heads and refs/tags on bare repos before archiving"
                    );
                }
            }
            BackupComponent::Artifacts => backup_artifacts(&work.join("artifacts"))
                .await
                .map_err(|e| format!("artifacts backup failed: {e:#}"))?,
        }
    }

    let manifest = BackupManifest {
        version: BACKUP_FORMAT_VERSION,
        app_version: version::display_version().to_string(),
        created_at: meta.created_at,
        components: components.clone(),
        registry_storage,
        db_format: if components.contains(&BackupComponent::Db) {
            Some("plain".into())
        } else {
            None
        },
        pg_client_version: pg_tool_version("pg_dump"),
        db_size_bytes,
        db_dump_bytes,
    };
    tokio::fs::write(
        work.join("manifest.json"),
        serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())?,
    )
    .await
    .map_err(|e| e.to_string())?;

    let archive_path = backup_archive_path(id);
    create_tar_gz(&work, &archive_path)
        .await
        .map_err(|e| format!("archive creation failed: {e:#}"))?;

    tokio::fs::remove_dir_all(&work)
        .await
        .map_err(|e| e.to_string())?;

    let archive_size = tokio::fs::metadata(&archive_path)
        .await
        .map(|m| m.len())
        .unwrap_or(0);

    meta.status = BackupJobStatus::Completed;
    meta.completed_at = Some(Utc::now());
    meta.archive_size_bytes = Some(archive_size);
    meta.db_dump_bytes = db_dump_bytes;
    meta.repos_entry_count = repos_entry_count;
    meta.error = None;
    if write_meta(&meta).await.is_err() {
        return Err("failed to finalize backup metadata".into());
    }
    tracing::info!(
        backup_id = %id,
        db_dump_bytes = ?db_dump_bytes,
        repos_entry_count = ?repos_entry_count,
        archive_size_bytes = archive_size,
        "backup completed"
    );
    Ok(())
}

async fn backup_db(database_url: &str, output: &Path) -> anyhow::Result<()> {
    let url = database_url.to_string();
    let dump_file = output.to_path_buf();
    let database = pg_connection_info(&url)?.database;
    tokio::task::spawn_blocking(move || {
        // Use libpq env vars (PGHOST, etc.) + -d dbname so pg_dump hits the same server as the API.
        // A bare postgres:// URI as the last argument is unreliable on some client builds.
        let result = run_pg_tool_with_stdio(
            "pg_dump",
            Some(&url),
            &[
                "--format=plain",
                "--clean",
                "--if-exists",
                "--no-owner",
                "--no-acl",
                "-f",
                &dump_file.display().to_string(),
                "-d",
                &database,
            ],
            Stdio::null(),
        )?;
        if !result.status.success() {
            let stderr = String::from_utf8_lossy(&result.stderr);
            anyhow::bail!(
                "pg_dump exited with {}: {}",
                result.status,
                stderr.trim()
            );
        }
        Ok(())
    })
    .await??;
    Ok(())
}

async fn backup_registry(pool: &PgPool, dest: &Path) -> anyhow::Result<()> {
    tokio::fs::create_dir_all(dest).await?;
    let entry_count = if registry_uses_s3_storage() {
        let backend = StorageBackend::from_env(&PathBuf::from(registry_root()))?;
        let paths: Vec<String> =
            sqlx::query_scalar("SELECT storage_path FROM container_blobs ORDER BY digest")
                .fetch_all(pool)
                .await?;
        for storage_path in &paths {
            let data = backend.get(storage_path).await?;
            let file_path = dest.join(storage_path);
            if let Some(parent) = file_path.parent() {
                tokio::fs::create_dir_all(parent).await?;
            }
            tokio::fs::write(&file_path, data).await?;
        }
        paths.len() as u64
    } else {
        let source = PathBuf::from(registry_root()).join("blobs");
        if source.exists() {
            copy_dir_recursive(&source, &dest.join("blobs")).await?;
        }
        count_backup_data_files(&dest.join("blobs"))?
    };
    write_backup_component_marker(dest, "registry", entry_count).await
}

async fn backup_artifacts(dest: &Path) -> anyhow::Result<()> {
    tokio::fs::create_dir_all(dest).await?;
    let source = PathBuf::from(artifacts_root());
    if source.exists() {
        copy_dir_recursive(&source, dest).await?;
    }
    let entry_count = count_backup_data_files(dest)?;
    write_backup_component_marker(dest, "artifacts", entry_count).await
}

async fn backup_repos(dest: &Path) -> anyhow::Result<()> {
    tokio::fs::create_dir_all(dest).await?;
    let source = PathBuf::from(repos_root());
    if source.exists() {
        copy_dir_recursive(&source, dest).await?;
    }
    let entry_count = count_backup_data_files(dest)?;
    write_backup_component_marker(dest, "repos", entry_count).await
}

async fn clear_directory_children(dir: &Path) -> anyhow::Result<()> {
    if !dir.exists() {
        return Ok(());
    }
    let mut entries = tokio::fs::read_dir(dir).await?;
    while let Some(entry) = entries.next_entry().await? {
        let path = entry.path();
        if path.is_dir() {
            tokio::fs::remove_dir_all(&path).await?;
        } else {
            tokio::fs::remove_file(&path).await?;
        }
    }
    Ok(())
}

async fn copy_dir_recursive(source: &Path, dest: &Path) -> anyhow::Result<()> {
    let mut stack = vec![(source.to_path_buf(), dest.to_path_buf())];
    while let Some((src, dst)) = stack.pop() {
        tokio::fs::create_dir_all(&dst).await?;
        let mut entries = tokio::fs::read_dir(&src).await?;
        while let Some(entry) = entries.next_entry().await? {
            let file_type = entry.file_type().await?;
            let src_path = entry.path();
            let dst_path = dst.join(entry.file_name());
            if file_type.is_dir() {
                stack.push((src_path, dst_path));
            } else if file_type.is_file() {
                tokio::fs::copy(&src_path, &dst_path).await?;
            }
        }
    }
    Ok(())
}

async fn create_tar_gz(source_dir: &Path, archive_path: &Path) -> anyhow::Result<()> {
    let source_dir = source_dir.to_path_buf();
    let archive_path = archive_path.to_path_buf();
    tokio::task::spawn_blocking(move || {
        let file = std::fs::File::create(&archive_path)?;
        let encoder = GzEncoder::new(file, Compression::default());
        let mut builder = Builder::new(encoder);
        builder.mode(tar::HeaderMode::Deterministic);
        for entry in walkdir_dirs_and_files(source_dir.as_path())? {
            let rel = entry
                .strip_prefix(&source_dir)
                .map_err(|e| anyhow::anyhow!(e))?;
            if rel.as_os_str().is_empty() {
                continue;
            }
            if entry.is_dir() {
                builder.append_dir(rel, &entry)?;
            } else {
                builder.append_path_with_name(&entry, rel)?;
            }
        }
        builder.into_inner()?.finish()?;
        Ok::<(), anyhow::Error>(())
    })
    .await??;
    Ok(())
}

fn walkdir_dirs_and_files(root: &Path) -> anyhow::Result<Vec<PathBuf>> {
    let mut entries = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        for entry in std::fs::read_dir(&dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.is_dir() {
                entries.push(path.clone());
                stack.push(path);
            } else if path.is_file() {
                entries.push(path);
            }
        }
    }
    entries.sort();
    Ok(entries)
}

fn walkdir(root: &Path) -> anyhow::Result<Vec<PathBuf>> {
    let mut files = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        for entry in std::fs::read_dir(&dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else if path.is_file() {
                files.push(path);
            }
        }
    }
    files.sort();
    Ok(files)
}

async fn delete_backup(
    State(state): State<AppState>,
    auth: AuthUser,
    AxumPath(backup_id): AxumPath<Uuid>,
) -> Result<StatusCode, ApiError> {
    admin::ensure_super_admin(&state.pool, auth.user_id).await?;
    let dir = backup_dir(backup_id);
    if !dir.exists() {
        return Err(DomainError::NotFound.into());
    }
    tokio::fs::remove_dir_all(&dir)
        .await
        .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;
    Ok(StatusCode::NO_CONTENT)
}

async fn download_backup(
    State(state): State<AppState>,
    auth: AuthUser,
    AxumPath(backup_id): AxumPath<Uuid>,
) -> Result<Response, ApiError> {
    admin::ensure_super_admin(&state.pool, auth.user_id).await?;
    let meta = read_meta(backup_id).await?;
    if meta.status != BackupJobStatus::Completed {
        return Err(DomainError::Validation("backup is not ready for download".into()).into());
    }
    let path = backup_archive_path(backup_id);
    if !path.is_file() {
        return Err(DomainError::NotFound.into());
    }

    let metadata = tokio::fs::metadata(&path)
        .await
        .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;
    let file_size = metadata.len();

    let file = tokio::fs::File::open(&path)
        .await
        .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;
    let stream = ReaderStream::new(file);
    let body = Body::from_stream(stream);
    let filename = format!("pertisk-backup-{backup_id}.tar.gz");

    Ok(Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/gzip")
        .header(header::CONTENT_LENGTH, file_size.to_string())
        .header(
            header::CONTENT_DISPOSITION,
            format!("attachment; filename=\"{filename}\""),
        )
        .body(body)
        .unwrap())
}

async fn restore_backup(
    State(state): State<AppState>,
    auth: AuthUser,
    mut multipart: Multipart,
) -> Result<Json<BackupJobResponse>, ApiError> {
    admin::ensure_super_admin(&state.pool, auth.user_id).await?;

    let id = Uuid::new_v4();
    let upload_dir = backup_dir(id);
    tokio::fs::create_dir_all(&upload_dir)
        .await
        .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;
    let archive_path = upload_dir.join("upload.tar.gz");

    let mut archive_size_bytes: Option<u64> = None;
    let mut components: Option<Vec<BackupComponent>> = None;
    let mut confirm: Option<String> = None;
    let upload_limit = backup_restore_max_upload_bytes();

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| {
            ApiError::from(DomainError::Validation(format!(
                "invalid multipart upload (backup may exceed {} MiB limit): {e}",
                upload_limit / (1024 * 1024)
            )))
        })?
    {
        match field.name() {
            Some("archive") => {
                let mut file = tokio::fs::File::create(&archive_path)
                    .await
                    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;
                let mut written = 0_u64;
                let mut field = field;
                while let Some(chunk) = field
                    .chunk()
                    .await
                    .map_err(|e| {
                        ApiError::from(DomainError::Validation(format!(
                            "failed to read backup upload data: {e}"
                        )))
                    })?
                {
                    written += chunk.len() as u64;
                    file.write_all(&chunk)
                        .await
                        .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;
                }
                archive_size_bytes = Some(written);
            }
            Some("components") => {
                let raw = field
                    .text()
                    .await
                    .map_err(|e| ApiError::from(DomainError::Validation(e.to_string())))?;
                components = Some(
                    serde_json::from_str(&raw)
                        .map_err(|e| DomainError::Validation(format!("invalid components: {e}")))?,
                );
            }
            Some("confirm") => {
                confirm = Some(
                    field
                        .text()
                        .await
                        .map_err(|e| ApiError::from(DomainError::Validation(e.to_string())))?,
                );
            }
            _ => {}
        }
    }

    let archive_size_bytes = archive_size_bytes
        .ok_or_else(|| DomainError::Validation("archive file is required".into()))?;
    let components = components
        .ok_or_else(|| DomainError::Validation("components are required".into()))?;
    if components.is_empty() {
        return Err(DomainError::Validation("select at least one component".into()).into());
    }
    if confirm.as_deref() != Some("RESTORE") {
        return Err(DomainError::Validation("type RESTORE to confirm".into()).into());
    }

    let meta = BackupJobMeta {
        id,
        status: BackupJobStatus::Running,
        components: components.clone(),
        created_at: Utc::now(),
        completed_at: None,
        error: None,
        archive_size_bytes: Some(archive_size_bytes),
        db_dump_bytes: None,
        repos_entry_count: None,
        created_by: Some(auth.user_id),
    };
    write_meta(&meta).await?;

    let extract_dir = backup_dir(id).join("restore");
    tokio::fs::create_dir_all(&extract_dir)
        .await
        .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    let database_url = state.config.database_url.clone();
    let pool = state.pool.clone();
    let restored_db = components.contains(&BackupComponent::Db);
    match run_restore(&archive_path, &extract_dir, &database_url, &pool, &components).await {
        Ok(()) => {
            let mut completed = meta.clone();
            completed.status = BackupJobStatus::Completed;
            completed.completed_at = Some(Utc::now());
            write_meta(&completed).await?;
            let _ = tokio::fs::remove_dir_all(backup_dir(id)).await;
            if restored_db {
                crate::db::schedule_restart_after_schema_change("database restore completed");
            }
            Ok(Json(to_job_response_with_flags(
                completed,
                restored_db.then_some(true),
            )))
        }
        Err(error) => {
            let mut failed = meta;
            failed.status = BackupJobStatus::Failed;
            failed.error = Some(error.clone());
            failed.completed_at = Some(Utc::now());
            write_meta(&failed).await?;
            Err(DomainError::Internal(error).into())
        }
    }
}

async fn run_restore(
    archive_path: &Path,
    extract_dir: &Path,
    database_url: &str,
    pool: &PgPool,
    components: &[BackupComponent],
) -> Result<(), String> {
    extract_tar_gz(archive_path, extract_dir)
        .await
        .map_err(|e| format!("extract archive failed: {e:#}"))?;

    let manifest_path = extract_dir.join("manifest.json");
    let manifest: BackupManifest = if manifest_path.is_file() {
        let raw = tokio::fs::read_to_string(&manifest_path)
            .await
            .map_err(|e| e.to_string())?;
        serde_json::from_str(&raw).map_err(|e| e.to_string())?
    } else {
        return Err("backup archive missing manifest.json".into());
    };

    if manifest.version != BACKUP_FORMAT_VERSION {
        return Err(format!(
            "unsupported backup format version {}",
            manifest.version
        ));
    }

    for component in components {
        if !manifest.components.contains(component) {
            return Err(format!("backup archive does not contain {component:?}"));
        }
        match component {
            BackupComponent::Db => {
                let dump_path = resolve_db_dump_path(extract_dir)
                    .ok_or_else(|| "database dump not found in backup (expected db.sql or db.dump)".to_string())?;
                restore_db(database_url, &dump_path)
                    .await
                    .map_err(|e| format!("database restore failed: {e:#}"))?
            }
            BackupComponent::Registry => restore_registry(pool, &extract_dir.join("registry"))
                .await
                .map_err(|e| format!("registry restore failed: {e:#}"))?,
            BackupComponent::Repos => {
                let repos_source = extract_dir.join("repos");
                if !repos_backup_has_data(&repos_source) {
                    return Err(
                        "backup archive has no git repository data (repos/ is empty). \
                         Create a new backup on the source server with Git repositories selected, \
                         then restore again with the repos component"
                            .into(),
                    );
                }
                restore_repos(&repos_source)
                    .await
                    .map_err(|e| format!("repositories restore failed: {e:#}"))?
            }
            BackupComponent::Artifacts => restore_artifacts(&extract_dir.join("artifacts"))
                .await
                .map_err(|e| format!("artifacts restore failed: {e:#}"))?,
        }
    }

    Ok(())
}

async fn extract_tar_gz(archive_path: &Path, dest: &Path) -> anyhow::Result<()> {
    let archive_path = archive_path.to_path_buf();
    let dest = dest.to_path_buf();
    tokio::task::spawn_blocking(move || {
        let file = std::fs::File::open(&archive_path)?;
        let decoder = flate2::read::GzDecoder::new(file);
        let mut archive = Archive::new(decoder);
        archive.unpack(&dest)?;
        Ok::<(), anyhow::Error>(())
    })
    .await??;
    Ok(())
}

async fn restore_db(database_url: &str, dump_path: &Path) -> anyhow::Result<()> {
    if !dump_path.is_file() {
        anyhow::bail!("database dump not found at {}", dump_path.display());
    }

    let format = if is_custom_pg_dump(dump_path)? {
        DbDumpFormat::Custom
    } else {
        DbDumpFormat::PlainSql
    };

    let url = database_url.to_string();
    let dump_path = dump_path.to_path_buf();
    let database = pg_connection_info(&url)?.database;
    tokio::task::spawn_blocking(move || match format {
        DbDumpFormat::PlainSql => {
            let result = run_pg_tool_with_stdio(
                "psql",
                Some(&url),
                &[
                    "-v",
                    "ON_ERROR_STOP=1",
                    "-d",
                    &database,
                    "-f",
                    &dump_path.display().to_string(),
                ],
                Stdio::piped(),
            )?;
            if !result.status.success() {
                let stderr = String::from_utf8_lossy(&result.stderr);
                let stdout = String::from_utf8_lossy(&result.stdout);
                let detail = if !stderr.trim().is_empty() {
                    stderr.trim()
                } else {
                    stdout.trim()
                };
                anyhow::bail!("psql exited with {}: {}", result.status, detail);
            }
            Ok(())
        }
        DbDumpFormat::Custom => {
            let result = run_pg_tool_with_stdio(
                "pg_restore",
                Some(&url),
                &[
                    "--clean",
                    "--if-exists",
                    "--no-owner",
                    "--no-acl",
                    "-d",
                    &database,
                    &dump_path.display().to_string(),
                ],
                Stdio::null(),
            )?;
            if !result.status.success() {
                let stderr = String::from_utf8_lossy(&result.stderr);
                if let Some(hint) = pg_restore_version_mismatch(&stderr) {
                    anyhow::bail!("{hint}\n\npg_restore stderr: {}", stderr.trim());
                }
                anyhow::bail!(
                    "pg_restore exited with {}: {}",
                    result.status,
                    stderr.trim()
                );
            }
            Ok(())
        }
    })
    .await??;
    Ok(())
}

async fn restore_registry(pool: &PgPool, source: &Path) -> anyhow::Result<()> {
    if !source.exists() {
        tracing::info!("no registry directory in backup archive; treating as empty registry");
        return Ok(());
    }

    let blob_files: Vec<PathBuf> = walkdir(source)?
        .into_iter()
        .filter(|path| !is_backup_component_marker(path))
        .filter(|path| {
            path.strip_prefix(source)
                .ok()
                .map(|rel| rel.components().count() > 0)
                .unwrap_or(false)
        })
        .collect();

    if blob_files.is_empty() {
        tracing::info!("registry backup has no blob files; skipping blob restore");
        return Ok(());
    }

    if registry_uses_s3_storage() {
        let backend = StorageBackend::from_env(&PathBuf::from(registry_root()))?;
        for file in blob_files {
            let rel = file
                .strip_prefix(source)
                .map_err(|e| anyhow::anyhow!(e))?;
            let key = rel.to_string_lossy().replace('\\', "/");
            let data = tokio::fs::read(&file).await?;
            backend.put(&key, &data).await?;
        }
    } else {
        let dest = PathBuf::from(registry_root()).join("blobs");
        if dest.exists() {
            tokio::fs::remove_dir_all(&dest).await.ok();
        }
        let src_blobs = source.join("blobs");
        if src_blobs.is_dir() {
            copy_dir_recursive(&src_blobs, &dest).await?;
        } else {
            for file in blob_files {
                let rel = file.strip_prefix(source).map_err(|e| anyhow::anyhow!(e))?;
                let dst_path = dest.join(rel);
                if let Some(parent) = dst_path.parent() {
                    tokio::fs::create_dir_all(parent).await?;
                }
                tokio::fs::copy(&file, &dst_path).await?;
            }
        }
    }
    let _ = pool;
    Ok(())
}

async fn restore_artifacts(source: &Path) -> anyhow::Result<()> {
    if !source.exists() {
        tracing::info!("no artifacts directory in backup archive; treating as empty artifacts");
        return Ok(());
    }

    let files: Vec<PathBuf> = walkdir(source)?
        .into_iter()
        .filter(|path| !is_backup_component_marker(path))
        .collect();
    if files.is_empty() {
        tracing::info!("artifacts backup has no files; skipping artifacts restore");
        return Ok(());
    }

    let dest = PathBuf::from(artifacts_root());
    for file in files {
        let rel = file.strip_prefix(source).map_err(|e| anyhow::anyhow!(e))?;
        let dst_path = dest.join(rel);
        if let Some(parent) = dst_path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        tokio::fs::copy(&file, &dst_path).await?;
    }
    Ok(())
}

fn repos_backup_has_data(source: &Path) -> bool {
    count_backup_data_files(source)
        .map(|count| count > 0)
        .unwrap_or(false)
}

async fn restore_repos(source: &Path) -> anyhow::Result<()> {
    if !source.exists() {
        tracing::info!("no repositories directory in backup archive; treating as empty repos");
        return Ok(());
    }

    if !repos_backup_has_data(source) {
        tracing::info!("repositories backup has no git data; skipping repos restore");
        return Ok(());
    }

    let file_count = count_backup_data_files(source)?;
    let dest = PathBuf::from(repos_root());
    tokio::fs::create_dir_all(&dest).await?;
    clear_directory_children(&dest).await?;
    copy_dir_recursive(source, &dest).await?;
    let marker = dest.join(BACKUP_COMPONENT_MARKER);
    if marker.is_file() {
        tokio::fs::remove_file(&marker).await.ok();
    }
    let repaired = repair_all_bare_repo_refs_dirs(&dest)?;
    tracing::info!(
        file_count,
        repaired,
        dest = %dest.display(),
        "restored git repositories"
    );
    Ok(())
}

impl std::fmt::Display for BackupComponent {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Db => write!(f, "db"),
            Self::Repos => write!(f, "repos"),
            Self::Registry => write!(f, "registry"),
            Self::Artifacts => write!(f, "artifacts"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_postgres_url_into_connection_info() {
        let info = pg_connection_info(
            "postgres://user:secret@192.0.2.10:5432/pertisk_gits?sslmode=require",
        )
        .unwrap();
        assert_eq!(info.host, "192.0.2.10");
        assert_eq!(info.port, "5432");
        assert_eq!(info.database, "pertisk_gits");
        assert_eq!(info.user, "user");
        assert_eq!(info.password.as_deref(), Some("secret"));
        assert_eq!(info.sslmode.as_deref(), Some("require"));
    }

    #[test]
    fn parses_postgresql_scheme() {
        let info = pg_connection_info("postgresql://localhost/mydb").unwrap();
        assert_eq!(info.host, "localhost");
        assert_eq!(info.port, "5432");
        assert_eq!(info.database, "mydb");
    }
}
