use std::sync::{LazyLock, OnceLock, RwLock};
use std::time::Instant;

use axum::{
    body::Body,
    extract::State,
    http::{Request, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use pertisk_domain::DomainError;
use prometheus::{
    register_counter_vec, register_histogram_vec, CounterVec, Encoder, HistogramVec, TextEncoder,
};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, reload, EnvFilter};
use validator::Validate;

use crate::{admin, ApiError, AppState, AuthUser};

static LOG_FILTER_HANDLE: OnceLock<reload::Handle<EnvFilter, tracing_subscriber::Registry>> =
    OnceLock::new();

static RUNTIME_SETTINGS: OnceLock<RwLock<ObservabilitySettings>> = OnceLock::new();

static HTTP_REQUESTS: LazyLock<CounterVec> = LazyLock::new(|| {
    register_counter_vec!(
        "pertisk_http_requests_total",
        "Total HTTP requests",
        &["method", "status"]
    )
    .expect("register pertisk_http_requests_total")
});

static HTTP_DURATION: LazyLock<HistogramVec> = LazyLock::new(|| {
    register_histogram_vec!(
        "pertisk_http_request_duration_seconds",
        "HTTP request duration in seconds",
        &["method"],
        vec![0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0]
    )
    .expect("register pertisk_http_request_duration_seconds")
});

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LogLevel {
    Trace,
    Debug,
    Info,
    Warn,
    Error,
}

impl LogLevel {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Trace => "trace",
            Self::Debug => "debug",
            Self::Info => "info",
            Self::Warn => "warn",
            Self::Error => "error",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "trace" => Some(Self::Trace),
            "debug" => Some(Self::Debug),
            "info" => Some(Self::Info),
            "warn" => Some(Self::Warn),
            "error" => Some(Self::Error),
            _ => None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct ObservabilitySettings {
    pub http_logging_enabled: bool,
    pub error_logging_enabled: bool,
    pub log_level: LogLevel,
    pub prometheus_enabled: bool,
}

impl Default for ObservabilitySettings {
    fn default() -> Self {
        Self {
            http_logging_enabled: true,
            error_logging_enabled: true,
            log_level: LogLevel::Info,
            prometheus_enabled: true,
        }
    }
}

#[derive(Debug, Clone, sqlx::FromRow)]
struct ObservabilitySettingsRow {
    http_logging_enabled: bool,
    error_logging_enabled: bool,
    log_level: String,
    prometheus_enabled: bool,
}

#[derive(Serialize)]
pub struct ObservabilitySettingsResponse {
    http_logging_enabled: bool,
    error_logging_enabled: bool,
    log_level: String,
    prometheus_enabled: bool,
    /// Effective `RUST_LOG` env var when set (takes precedence over admin log level).
    rust_log_env: Option<String>,
    log_level_managed: bool,
}

#[derive(Deserialize, Validate)]
pub struct UpdateObservabilitySettingsRequest {
    pub http_logging_enabled: Option<bool>,
    pub error_logging_enabled: Option<bool>,
    pub log_level: Option<String>,
    pub prometheus_enabled: Option<bool>,
}

pub fn observability_routes() -> Router<AppState> {
    Router::new()
        .route("/admin/observability", get(get_observability_settings).put(update_observability_settings))
        .route("/admin/metrics", get(admin_prometheus_metrics))
}

pub fn init_tracing_subscriber() {
    let default_filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| "info,pertisk_api=debug".into());

    let (filter, handle) = reload::Layer::new(default_filter);
    let _ = LOG_FILTER_HANDLE.set(handle);

    tracing_subscriber::registry()
        .with(filter)
        .with(tracing_subscriber::fmt::layer())
        .init();
}

pub async fn init_from_db(pool: &PgPool) -> Result<(), ApiError> {
    let settings = load_settings_from_db(pool).await?;
    let _ = RUNTIME_SETTINGS.set(RwLock::new(settings.clone()));
    apply_log_level(&settings.log_level);
    Ok(())
}

fn runtime_settings() -> &'static RwLock<ObservabilitySettings> {
    RUNTIME_SETTINGS.get_or_init(|| RwLock::new(ObservabilitySettings::default()))
}

fn current_settings() -> ObservabilitySettings {
    runtime_settings()
        .read()
        .map(|guard| guard.clone())
        .unwrap_or_default()
}

async fn load_settings_from_db(pool: &PgPool) -> Result<ObservabilitySettings, ApiError> {
    let row = sqlx::query_as::<_, ObservabilitySettingsRow>(
        r#"
        SELECT http_logging_enabled, error_logging_enabled, log_level, prometheus_enabled
        FROM observability_settings
        WHERE id = 1
        "#,
    )
    .fetch_optional(pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?
    .unwrap_or_default();

    Ok(row.into())
}

impl Default for ObservabilitySettingsRow {
    fn default() -> Self {
        Self {
            http_logging_enabled: true,
            error_logging_enabled: true,
            log_level: "info".into(),
            prometheus_enabled: true,
        }
    }
}

impl From<ObservabilitySettingsRow> for ObservabilitySettings {
    fn from(row: ObservabilitySettingsRow) -> Self {
        Self {
            http_logging_enabled: row.http_logging_enabled,
            error_logging_enabled: row.error_logging_enabled,
            log_level: LogLevel::parse(&row.log_level).unwrap_or(LogLevel::Info),
            prometheus_enabled: row.prometheus_enabled,
        }
    }
}

fn apply_log_level(level: &LogLevel) {
    if std::env::var("RUST_LOG").is_ok() {
        return;
    }

    let Some(handle) = LOG_FILTER_HANDLE.get() else {
        return;
    };

    let filter = format!(
        "{level},pertisk_api={level},tower_http=warn",
        level = level.as_str()
    );
    if let Err(err) = handle.modify(|env| *env = EnvFilter::new(&filter)) {
        tracing::warn!(%err, "failed to update tracing log filter");
    }
}

pub fn log_api_error(status: StatusCode, message: &str, path: &str) {
    let settings = current_settings();
    if !settings.error_logging_enabled {
        return;
    }

    if status.is_server_error() {
        tracing::error!(%status, %path, error = %message, "api error");
    } else if status.is_client_error() {
        tracing::warn!(%status, %path, error = %message, "api error");
    }
}

pub async fn http_observability_middleware(request: Request<Body>, next: Next) -> Response {
    let method = request.method().to_string();
    let path = request.uri().path().to_string();
    let started = Instant::now();

    let response = next.run(request).await;
    let status = response.status();
    let elapsed = started.elapsed();
    let settings = current_settings();

    if settings.prometheus_enabled {
        let status_label = status.as_u16().to_string();
        if let Ok(counter) = HTTP_REQUESTS.get_metric_with_label_values(&[&method, &status_label]) {
            counter.inc();
        }
        if let Ok(histogram) = HTTP_DURATION.get_metric_with_label_values(&[&method]) {
            histogram.observe(elapsed.as_secs_f64());
        }
    }

    if settings.http_logging_enabled {
        tracing::info!(
            method = %method,
            path = %path,
            status = %status.as_u16(),
            duration_ms = elapsed.as_secs_f64() * 1000.0,
            "http request"
        );
    }

    if settings.error_logging_enabled && status.is_client_error() && !is_expected_client_error(&method, &path, status) {
        tracing::warn!(
            method = %method,
            path = %path,
            status = %status.as_u16(),
            "http client error"
        );
    } else if settings.error_logging_enabled && status.is_server_error() {
        tracing::error!(
            method = %method,
            path = %path,
            status = %status.as_u16(),
            "http server error"
        );
    }

    response
}

fn is_expected_client_error(method: &str, path: &str, status: StatusCode) -> bool {
    // Docker push preflight often probes blob existence via HEAD and expects 404
    // before it uploads the missing layer.
    status == StatusCode::NOT_FOUND
        && method == "HEAD"
        && path.starts_with("/v2/")
        && path.contains("/blobs/sha256:")
}

async fn get_observability_settings(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<ObservabilitySettingsResponse>, ApiError> {
    admin::ensure_super_admin(&state.pool, auth.user_id).await?;
    let settings = load_settings_from_db(&state.pool).await?;
    Ok(Json(settings_to_response(settings)))
}

async fn update_observability_settings(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(body): Json<UpdateObservabilitySettingsRequest>,
) -> Result<Json<ObservabilitySettingsResponse>, ApiError> {
    admin::ensure_super_admin(&state.pool, auth.user_id).await?;
    body.validate()
        .map_err(|e| ApiError::from(DomainError::Validation(e.to_string())))?;

    let current = load_settings_from_db(&state.pool).await?;

    let log_level = match body.log_level.as_deref() {
        Some(value) => LogLevel::parse(value)
            .ok_or_else(|| DomainError::Validation("invalid log_level".into()))?,
        None => current.log_level,
    };

    let updated = ObservabilitySettings {
        http_logging_enabled: body.http_logging_enabled.unwrap_or(current.http_logging_enabled),
        error_logging_enabled: body
            .error_logging_enabled
            .unwrap_or(current.error_logging_enabled),
        log_level,
        prometheus_enabled: body.prometheus_enabled.unwrap_or(current.prometheus_enabled),
    };

    sqlx::query(
        r#"
        UPDATE observability_settings
        SET
            http_logging_enabled = $1,
            error_logging_enabled = $2,
            log_level = $3,
            prometheus_enabled = $4,
            updated_at = NOW()
        WHERE id = 1
        "#,
    )
    .bind(updated.http_logging_enabled)
    .bind(updated.error_logging_enabled)
    .bind(updated.log_level.as_str())
    .bind(updated.prometheus_enabled)
    .execute(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    if let Ok(mut guard) = runtime_settings().write() {
        *guard = updated.clone();
    }
    apply_log_level(&updated.log_level);

    tracing::info!(
        user_id = %auth.user_id,
        http_logging = updated.http_logging_enabled,
        error_logging = updated.error_logging_enabled,
        log_level = updated.log_level.as_str(),
        prometheus = updated.prometheus_enabled,
        "observability settings updated"
    );

    Ok(Json(settings_to_response(updated)))
}

async fn admin_prometheus_metrics(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Response, ApiError> {
    admin::ensure_super_admin(&state.pool, auth.user_id).await?;

    let settings = current_settings();
    if !settings.prometheus_enabled {
        return Err(DomainError::Validation("prometheus metrics are disabled".into()).into());
    }

    let encoder = TextEncoder::new();
    let metric_families = prometheus::gather();
    let mut buffer = Vec::new();
    encoder
        .encode(&metric_families, &mut buffer)
        .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    Ok((
        StatusCode::OK,
        [(
            axum::http::header::CONTENT_TYPE,
            encoder.format_type().to_string(),
        )],
        buffer,
    )
        .into_response())
}

fn settings_to_response(settings: ObservabilitySettings) -> ObservabilitySettingsResponse {
    let rust_log_env = std::env::var("RUST_LOG").ok();
    ObservabilitySettingsResponse {
        http_logging_enabled: settings.http_logging_enabled,
        error_logging_enabled: settings.error_logging_enabled,
        log_level: settings.log_level.as_str().to_string(),
        prometheus_enabled: settings.prometheus_enabled,
        rust_log_env: rust_log_env.clone(),
        log_level_managed: rust_log_env.is_none(),
    }
}

#[cfg(test)]
mod tests {
    use super::LogLevel;

    #[test]
    fn parses_log_levels() {
        assert_eq!(LogLevel::parse("INFO"), Some(LogLevel::Info));
        assert_eq!(LogLevel::parse("warn"), Some(LogLevel::Warn));
        assert!(LogLevel::parse("verbose").is_none());
    }
}
