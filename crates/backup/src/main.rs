use std::collections::HashMap;
use std::ffi::OsString;
use std::fs;
use std::fs::File;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use anyhow::{anyhow, bail, Context, Result};
use chrono::Utc;
use clap::{Parser, Subcommand};
use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;
use serde::Serialize;
use tar::{Archive, Builder};
use tempfile::TempDir;
use walkdir::WalkDir;

const DEFAULT_CONFIG_FILE: &str = "/etc/pertisk-gits/pertisk-gits.conf";
const CONFIG_FILE_ENV: &str = "PERTISK_CONFIG_FILE";

#[derive(Parser)]
#[command(name = "pertisk-backup", about = "GitLab-style backup/restore helper for Pertisk")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Create a backup archive.
    Create {
        /// GitLab-style KEY=VALUE arguments, for example SKIP=db,repositories BACKUP=myid
        #[arg(value_name = "KEY=VALUE", trailing_var_arg = true)]
        kv: Vec<String>,
    },
    /// Restore from a backup archive.
    Restore {
        /// GitLab-style KEY=VALUE arguments, for example BACKUP=myid CONFIRM=RESTORE
        #[arg(value_name = "KEY=VALUE", trailing_var_arg = true)]
        kv: Vec<String>,
    },
    /// List backup archives in BACKUPS_ROOT.
    List {
        /// Optional KEY=VALUE argument list.
        #[arg(value_name = "KEY=VALUE", trailing_var_arg = true)]
        kv: Vec<String>,
    },
}

#[derive(Clone, Debug)]
struct Config {
    backups_root: PathBuf,
    repos_root: PathBuf,
    registry_root: PathBuf,
    artifacts_root: PathBuf,
    database_url: Option<String>,
    backup_storage: String,
    aws_cli_bin: Option<String>,
    s3_endpoint: Option<String>,
    s3_bucket: Option<String>,
    s3_prefix: String,
    backup_s3_uri: Option<String>,
    assume_yes: bool,
    confirm: Option<String>,
    db_restore_clean: bool,
    restore_tmp_root: PathBuf,
}

#[derive(Default, Clone, Debug)]
struct RuntimeOptions {
    skip: String,
    backup_id: Option<String>,
}

#[derive(Serialize)]
struct BackupManifest {
    backup_id: String,
    created_at: String,
    version: String,
    components: ManifestComponents,
}

#[derive(Serialize)]
struct ManifestComponents {
    db: bool,
    repositories: bool,
    registry: bool,
    artifacts: bool,
}

fn main() -> Result<()> {
    preload_config_env();
    let cli = Cli::parse();
    match cli.command {
        Commands::Create { kv } => {
            let env_overrides = parse_kv_args(&kv)?;
            let cfg = Config::from_overrides(&env_overrides)?;
            let opts = RuntimeOptions::from_overrides(&env_overrides);
            run_create(&cfg, &opts)
        }
        Commands::Restore { kv } => {
            let env_overrides = parse_kv_args(&kv)?;
            let cfg = Config::from_overrides(&env_overrides)?;
            let opts = RuntimeOptions::from_overrides(&env_overrides);
            run_restore(&cfg, &opts)
        }
        Commands::List { kv } => {
            let env_overrides = parse_kv_args(&kv)?;
            let cfg = Config::from_overrides(&env_overrides)?;
            run_list(&cfg)
        }
    }
}

fn preload_config_env() {
    let config_path = std::env::var(CONFIG_FILE_ENV)
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(DEFAULT_CONFIG_FILE));

    if let Err(err) = load_env_file_if_exists(&config_path) {
        log(&format!(
            "Failed to load config file {}: {err}",
            config_path.display()
        ));
    }
}

fn load_env_file_if_exists(path: &Path) -> Result<()> {
    if !path.exists() {
        return Ok(());
    }

    let contents = fs::read_to_string(path)
        .with_context(|| format!("read config file {}", path.display()))?;

    for line in contents.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        let raw = trimmed.strip_prefix("export ").unwrap_or(trimmed);
        let Some((raw_key, raw_value)) = raw.split_once('=') else {
            continue;
        };

        let key = raw_key.trim();
        if key.is_empty() || std::env::var_os(key).is_some() {
            continue;
        }

        let value = strip_wrapping_quotes(raw_value.trim());
        std::env::set_var(key, value);
    }

    Ok(())
}

fn strip_wrapping_quotes(value: &str) -> String {
    if value.len() >= 2 {
        let starts_ends_with_double = value.starts_with('"') && value.ends_with('"');
        let starts_ends_with_single = value.starts_with('\'') && value.ends_with('\'');
        if starts_ends_with_double || starts_ends_with_single {
            return value[1..value.len() - 1].to_string();
        }
    }
    value.to_string()
}

fn infer_data_root_from_repos_root(repos_root: &str) -> Option<PathBuf> {
    let repos_path = Path::new(repos_root);
    if !repos_path.is_absolute() {
        return None;
    }

    let parent = repos_path.parent()?;
    if parent.file_name().and_then(|s| s.to_str()) == Some("data") {
        Some(parent.to_path_buf())
    } else {
        Some(parent.join("data"))
    }
}

fn default_from_data_root(data_root: Option<&Path>, suffix: &str, fallback: &str) -> String {
    data_root
        .map(|root| root.join(suffix).to_string_lossy().to_string())
        .unwrap_or_else(|| fallback.to_string())
}

impl Config {
    fn from_overrides(overrides: &HashMap<String, String>) -> Result<Self> {
        let repos_root = get_value(overrides, "REPOS_ROOT").unwrap_or_else(|| "data/repos".into());
        let data_root = infer_data_root_from_repos_root(&repos_root);
        let backups_root = get_value(overrides, "BACKUPS_ROOT")
            .unwrap_or_else(|| default_from_data_root(data_root.as_deref(), "backups", "data/backups"));
        let registry_root = get_value(overrides, "REGISTRY_ROOT")
            .unwrap_or_else(|| default_from_data_root(data_root.as_deref(), "registry", "data/registry"));
        let artifacts_root = get_value(overrides, "ARTIFACTS_ROOT")
            .unwrap_or_else(|| default_from_data_root(data_root.as_deref(), "artifacts", "data/artifacts"));
        let backup_storage =
            get_value(overrides, "BACKUP_STORAGE").unwrap_or_else(|| "local".to_string());
        let s3_prefix =
            get_value(overrides, "S3_PREFIX").unwrap_or_else(|| "pertisk-backups".to_string());

        let restore_tmp_root = get_value(overrides, "RESTORE_TMP_ROOT")
            .map(PathBuf::from)
            .unwrap_or_else(|| Path::new(&backups_root).join("tmp"));

        Ok(Self {
            backups_root: PathBuf::from(backups_root),
            repos_root: PathBuf::from(repos_root),
            registry_root: PathBuf::from(registry_root),
            artifacts_root: PathBuf::from(artifacts_root),
            database_url: get_value(overrides, "DATABASE_URL"),
            backup_storage,
            aws_cli_bin: get_value(overrides, "AWS_CLI_BIN"),
            s3_endpoint: get_value(overrides, "S3_ENDPOINT"),
            s3_bucket: get_value(overrides, "S3_BUCKET"),
            s3_prefix,
            backup_s3_uri: get_value(overrides, "BACKUP_S3_URI"),
            assume_yes: is_truthy(get_value(overrides, "ASSUME_YES").as_deref()),
            confirm: get_value(overrides, "CONFIRM"),
            db_restore_clean: !is_falsey(get_value(overrides, "DB_RESTORE_CLEAN").as_deref()),
            restore_tmp_root,
        })
    }
}

impl RuntimeOptions {
    fn from_overrides(overrides: &HashMap<String, String>) -> Self {
        Self {
            skip: get_value(overrides, "SKIP").unwrap_or_default(),
            backup_id: get_value(overrides, "BACKUP"),
        }
    }
}

fn parse_kv_args(kv: &[String]) -> Result<HashMap<String, String>> {
    let mut out = HashMap::new();
    for item in kv {
        let (k, v) = item
            .split_once('=')
            .ok_or_else(|| anyhow!("invalid argument '{item}', expected KEY=VALUE"))?;
        out.insert(k.trim().to_string(), v.to_string());
    }
    Ok(out)
}

fn get_value(overrides: &HashMap<String, String>, key: &str) -> Option<String> {
    overrides
        .get(key)
        .cloned()
        .or_else(|| std::env::var(key).ok())
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

fn log(message: &str) {
    eprintln!("[{}] {}", Utc::now().format("%Y-%m-%d %H:%M:%S"), message);
}

fn normalize_token(token: &str) -> String {
    match token.trim().to_lowercase().replace('-', "_").as_str() {
        "db" | "database" => "db".to_string(),
        "repositories" | "repos" | "repository" => "repositories".to_string(),
        "registry" => "registry".to_string(),
        "artifacts" | "artifact" => "artifacts".to_string(),
        "tar" => "tar".to_string(),
        "remote" => "remote".to_string(),
        other => other.to_string(),
    }
}

fn csv_has(csv: &str, needle: &str) -> bool {
    let needle = normalize_token(needle);
    csv.split(',').any(|item| normalize_token(item) == needle)
}

fn is_truthy(value: Option<&str>) -> bool {
    matches!(value.map(|v| v.to_lowercase()), Some(v) if v == "1" || v == "true" || v == "yes")
}

fn is_falsey(value: Option<&str>) -> bool {
    matches!(value.map(|v| v.to_lowercase()), Some(v) if v == "0" || v == "false" || v == "no")
}

fn sanitize_backup_id_token(value: &str) -> String {
    value
        .trim()
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-') {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>()
}

fn normalize_version_input(value: &str) -> String {
    value.trim().trim_start_matches(['v', 'V']).to_string()
}

fn backup_id_now() -> String {
    let now = Utc::now();
    let app_ver = std::env::var("PERTISK_VERSION")
        .or_else(|_| std::env::var("APP_VERSION"))
        .map(|value| normalize_version_input(&value))
        .unwrap_or_else(|_| env!("PERTISK_APP_VERSION").to_string());
    let app_ver = sanitize_backup_id_token(&app_ver);
    let app_ver = if app_ver.trim_matches('_').is_empty() {
        env!("PERTISK_APP_VERSION").to_string()
    } else {
        app_ver
    };
    format!("{}_{}_{}", now.timestamp(), now.format("%Y_%m_%d"), app_ver)
}

fn archive_path(backups_root: &Path, backup_id: &str) -> PathBuf {
    backups_root.join(format!("{backup_id}_pertisk_backup.tar.gz"))
}

fn work_path(backups_root: &Path, backup_id: &str) -> PathBuf {
    backups_root.join(backup_id)
}

fn latest_backup_id(backups_root: &Path) -> Result<Option<String>> {
    if !backups_root.exists() {
        return Ok(None);
    }

    let mut ids = Vec::new();
    for entry in fs::read_dir(backups_root).with_context(|| format!("read_dir {}", backups_root.display()))? {
        let entry = entry?;
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        if let Some(id) = name.strip_suffix("_pertisk_backup.tar.gz") {
            ids.push(id.to_string());
        }
    }
    ids.sort();
    Ok(ids.pop())
}

fn s3_uri_for_backup(cfg: &Config, backup_id: &str) -> Result<String> {
    if let Some(base) = &cfg.backup_s3_uri {
        return Ok(format!("{}/{}_pertisk_backup.tar.gz", base.trim_end_matches('/'), backup_id));
    }
    let bucket = cfg
        .s3_bucket
        .as_ref()
        .ok_or_else(|| anyhow!("S3 bucket missing (set S3_BUCKET or BACKUP_S3_URI)"))?;
    Ok(format!(
        "s3://{}/{}/{}_pertisk_backup.tar.gz",
        bucket,
        cfg.s3_prefix.trim_end_matches('/'),
        backup_id
    ))
}

fn ensure_dir(path: &Path) -> Result<()> {
    fs::create_dir_all(path).with_context(|| format!("create_dir_all {}", path.display()))
}

fn copy_tree(src: &Path, dst: &Path) -> Result<()> {
    if !src.exists() {
        return Ok(());
    }
    ensure_dir(dst)?;
    for entry in WalkDir::new(src) {
        let entry = entry?;
        let rel = entry.path().strip_prefix(src)?;
        let target = dst.join(rel);
        if entry.file_type().is_dir() {
            ensure_dir(&target)?;
        } else if entry.file_type().is_file() {
            if let Some(parent) = target.parent() {
                ensure_dir(parent)?;
            }
            fs::copy(entry.path(), &target).with_context(|| {
                format!(
                    "copy {} -> {}",
                    entry.path().display(),
                    target.display()
                )
            })?;
        }
    }
    Ok(())
}

fn clear_dir_contents(dir: &Path) -> Result<()> {
    ensure_dir(dir)?;
    for entry in fs::read_dir(dir).with_context(|| format!("read_dir {}", dir.display()))? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            fs::remove_dir_all(&path).with_context(|| format!("remove_dir_all {}", path.display()))?;
        } else {
            fs::remove_file(&path).with_context(|| format!("remove_file {}", path.display()))?;
        }
    }
    Ok(())
}

fn run_cmd(mut cmd: Command, what: &str) -> Result<()> {
    let status = cmd
        .status()
        .with_context(|| format!("failed to run {what}"))?;
    if !status.success() {
        bail!("{what} failed with status {status}");
    }
    Ok(())
}

fn run_create(cfg: &Config, opts: &RuntimeOptions) -> Result<()> {
    ensure_dir(&cfg.backups_root)?;

    let backup_id = opts.backup_id.clone().unwrap_or_else(backup_id_now);
    let work_dir = work_path(&cfg.backups_root, &backup_id);
    let tar_path = archive_path(&cfg.backups_root, &backup_id);

    if work_dir.exists() || tar_path.exists() {
        bail!("backup id already exists: {backup_id}");
    }

    ensure_dir(&work_dir)?;

    let manifest = BackupManifest {
        backup_id: backup_id.clone(),
        created_at: Utc::now().to_rfc3339(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        components: ManifestComponents {
            db: !csv_has(&opts.skip, "db"),
            repositories: !csv_has(&opts.skip, "repositories"),
            registry: !csv_has(&opts.skip, "registry"),
            artifacts: !csv_has(&opts.skip, "artifacts"),
        },
    };
    fs::write(
        work_dir.join("manifest.json"),
        serde_json::to_vec_pretty(&manifest)?,
    )?;

    if !csv_has(&opts.skip, "db") {
        let db_url = cfg
            .database_url
            .as_ref()
            .ok_or_else(|| anyhow!("DATABASE_URL is required for database backup"))?;
        log("Dumping PostgreSQL database");
        let mut cmd = Command::new("pg_dump");
        cmd.arg("--no-owner")
            .arg("--no-privileges")
            .arg(db_url)
            .stdout(Stdio::from(File::create(work_dir.join("db.sql"))?));
        run_cmd(cmd, "pg_dump")?;
    } else {
        log("Skipping database backup");
    }

    if !csv_has(&opts.skip, "repositories") {
        log(&format!("Backing up repositories from {}", cfg.repos_root.display()));
        copy_tree(&cfg.repos_root, &work_dir.join("repos"))?;
    } else {
        log("Skipping repositories backup");
    }

    if !csv_has(&opts.skip, "registry") {
        log(&format!("Backing up registry from {}", cfg.registry_root.display()));
        copy_tree(&cfg.registry_root, &work_dir.join("registry"))?;
    } else {
        log("Skipping registry backup");
    }

    if !csv_has(&opts.skip, "artifacts") {
        log(&format!("Backing up artifacts from {}", cfg.artifacts_root.display()));
        copy_tree(&cfg.artifacts_root, &work_dir.join("artifacts"))?;
    } else {
        log("Skipping artifacts backup");
    }

    if !csv_has(&opts.skip, "tar") {
        log("Creating backup archive");
        let tar_gz = File::create(&tar_path).with_context(|| format!("create {}", tar_path.display()))?;
        let encoder = GzEncoder::new(tar_gz, Compression::default());
        let mut tar = Builder::new(encoder);
        tar.append_dir_all(&backup_id, &work_dir)
            .with_context(|| format!("archive {}", work_dir.display()))?;
        tar.finish()?;
    } else {
        log("Skipping archive creation (SKIP includes tar)");
    }

    if !csv_has(&opts.skip, "remote") {
        match cfg.backup_storage.to_lowercase().as_str() {
            "local" | "" => {}
            "s3" | "minio" | "rustfs" => {
                if csv_has(&opts.skip, "tar") {
                    bail!("remote upload requires archive; remove tar from SKIP");
                }
                let uri = s3_uri_for_backup(cfg, &backup_id)?;
                log(&format!("Uploading backup archive to object storage: {uri}"));
                run_aws_cp(cfg, &tar_path, &uri)?;
            }
            other => bail!("unsupported BACKUP_STORAGE: {other}"),
        }
    } else {
        log("Skipping remote upload");
    }

    log(&format!("Backup completed: {backup_id}"));
    if tar_path.exists() {
        log(&format!("Archive: {}", tar_path.display()));
    } else {
        log(&format!("Directory backup: {}", work_dir.display()));
    }

    Ok(())
}

fn run_restore(cfg: &Config, opts: &RuntimeOptions) -> Result<()> {
    let backup_id = if let Some(id) = &opts.backup_id {
        id.clone()
    } else {
        latest_backup_id(&cfg.backups_root)?.ok_or_else(|| anyhow!("BACKUP is required when no local backups exist"))?
    };

    if !cfg.assume_yes && cfg.confirm.as_deref() != Some("RESTORE") {
        bail!("restore requires CONFIRM=RESTORE (or ASSUME_YES=1)");
    }

    ensure_dir(&cfg.backups_root)?;
    ensure_dir(&cfg.restore_tmp_root)?;

    let tar_path = archive_path(&cfg.backups_root, &backup_id);
    if !tar_path.exists() {
        match cfg.backup_storage.to_lowercase().as_str() {
            "s3" | "minio" | "rustfs" => {
                let uri = s3_uri_for_backup(cfg, &backup_id)?;
                log(&format!("Local backup not found; downloading from object storage: {uri}"));
                run_aws_cp_down(cfg, &uri, &tar_path)?;
            }
            _ => bail!("backup archive not found: {}", tar_path.display()),
        }
    }

    let temp = TempDir::new_in(&cfg.restore_tmp_root)
        .with_context(|| format!("create temp dir in {}", cfg.restore_tmp_root.display()))?;
    let extract_dir = temp.path().join(format!("restore-{backup_id}"));
    ensure_dir(&extract_dir)?;

    log("Extracting backup archive");
    let file = File::open(&tar_path).with_context(|| format!("open {}", tar_path.display()))?;
    let decoder = GzDecoder::new(file);
    let mut archive = Archive::new(decoder);
    archive.unpack(&extract_dir)?;

    let root = extract_dir.join(&backup_id);
    if !root.exists() {
        bail!("invalid backup archive structure: expected folder {backup_id}");
    }

    if !csv_has(&opts.skip, "db") && root.join("db.sql").exists() {
        let db_url = cfg
            .database_url
            .as_ref()
            .ok_or_else(|| anyhow!("DATABASE_URL is required for database restore"))?;

        if cfg.db_restore_clean {
            log("Cleaning public schema before restore");
            let mut cmd = Command::new("psql");
            cmd.arg(db_url)
                .arg("-v")
                .arg("ON_ERROR_STOP=1")
                .arg("-c")
                .arg("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
            run_cmd(cmd, "psql schema clean")?;
        }

        log("Restoring database from SQL dump");
        let mut cmd = Command::new("psql");
        cmd.arg(db_url)
            .arg("-v")
            .arg("ON_ERROR_STOP=1")
            .arg("-f")
            .arg(root.join("db.sql"));
        run_cmd(cmd, "psql restore")?;
    } else {
        log("Skipping database restore");
    }

    if !csv_has(&opts.skip, "repositories") && root.join("repos").exists() {
        log(&format!("Restoring repositories into {}", cfg.repos_root.display()));
        clear_dir_contents(&cfg.repos_root)?;
        copy_tree(&root.join("repos"), &cfg.repos_root)?;
    } else {
        log("Skipping repositories restore");
    }

    if !csv_has(&opts.skip, "registry") && root.join("registry").exists() {
        log(&format!("Restoring registry into {}", cfg.registry_root.display()));
        clear_dir_contents(&cfg.registry_root)?;
        copy_tree(&root.join("registry"), &cfg.registry_root)?;
    } else {
        log("Skipping registry restore");
    }

    if !csv_has(&opts.skip, "artifacts") && root.join("artifacts").exists() {
        log(&format!("Restoring artifacts into {}", cfg.artifacts_root.display()));
        clear_dir_contents(&cfg.artifacts_root)?;
        copy_tree(&root.join("artifacts"), &cfg.artifacts_root)?;
    } else {
        log("Skipping artifacts restore");
    }

    log(&format!("Restore completed for backup: {backup_id}"));
    log("Restart pertisk-gits after restore to refresh DB connections");
    Ok(())
}

fn run_list(cfg: &Config) -> Result<()> {
    if !cfg.backups_root.exists() {
        log(&format!("No local backup directory: {}", cfg.backups_root.display()));
        return Ok(());
    }

    let mut rows = Vec::new();
    for entry in fs::read_dir(&cfg.backups_root)
        .with_context(|| format!("read_dir {}", cfg.backups_root.display()))?
    {
        let entry = entry?;
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|s| s.to_str()) else {
            continue;
        };
        if let Some(id) = name.strip_suffix("_pertisk_backup.tar.gz") {
            rows.push((id.to_string(), path));
        }
    }

    rows.sort_by(|a, b| a.0.cmp(&b.0));
    if rows.is_empty() {
        log("No local backup archives found");
    } else {
        for (id, path) in rows {
            println!("{id}\t{}", path.display());
        }
    }

    Ok(())
}

fn run_aws_cp(cfg: &Config, src: &Path, dst: &str) -> Result<()> {
    let mut cmd = aws_base_command(cfg)?;
    cmd.arg("s3").arg("cp").arg(src).arg(dst);
    run_cmd(cmd, "aws s3 cp upload")
}

fn run_aws_cp_down(cfg: &Config, src: &str, dst: &Path) -> Result<()> {
    let mut cmd = aws_base_command(cfg)?;
    cmd.arg("s3").arg("cp").arg(src).arg(dst);
    run_cmd(cmd, "aws s3 cp download")
}

fn aws_base_command(cfg: &Config) -> Result<Command> {
    let aws_bin = resolve_aws_cli_bin(cfg)?;
    let mut cmd = Command::new(&aws_bin);

    if let Some(endpoint) = &cfg.s3_endpoint {
        cmd.arg("--endpoint-url").arg(endpoint);
    }

    if let Ok(key) = std::env::var("S3_ACCESS_KEY") {
        cmd.env("AWS_ACCESS_KEY_ID", key);
    }
    if let Ok(secret) = std::env::var("S3_SECRET_KEY") {
        cmd.env("AWS_SECRET_ACCESS_KEY", secret);
    }

    Ok(cmd)
}

fn resolve_aws_cli_bin(cfg: &Config) -> Result<String> {
    if let Some(bin) = &cfg.aws_cli_bin {
        if binary_exists(bin) {
            return Ok(bin.clone());
        }
        bail!(
            "AWS_CLI_BIN is set but not executable/found: {}",
            bin
        );
    }

    for candidate in ["aws", "/usr/local/bin/aws", "/usr/bin/aws"] {
        if binary_exists(candidate) {
            return Ok(candidate.to_string());
        }
    }

    bail!(
        "aws CLI not found. Install awscli or set AWS_CLI_BIN in /etc/pertisk-gits/pertisk-gits.conf (for example AWS_CLI_BIN=/usr/local/bin/aws)"
    );
}

fn binary_exists(binary: &str) -> bool {
    let path = Path::new(binary);
    if path.components().count() > 1 {
        return path.is_file();
    }

    std::env::var_os("PATH")
        .map(|path_var| {
            std::env::split_paths(&path_var).any(|dir| {
                let candidate = dir.join(binary);
                candidate.is_file()
            })
        })
        .unwrap_or(false)
}

#[allow(dead_code)]
fn _to_os_string(path: &Path) -> OsString {
    path.as_os_str().to_os_string()
}
