pub mod access;
pub mod auth;
pub mod config;
pub mod gc;
pub mod routes;
pub mod storage;

use axum::{
    extract::DefaultBodyLimit,
    routing::{get, patch, post},
    Router,
};
use routes::v2::RegistryState;

/// Docker layers can be hundreds of MB; axum's default limit is 2 MiB.
const MAX_REGISTRY_BODY_BYTES: usize = 5 * 1024 * 1024 * 1024;

pub fn router() -> Router<RegistryState> {
    Router::new()
        .route("/service/token", get(routes::token::get_token))
        .route("/v2/", get(routes::v2::version_check))
        .route(
            "/v2/{org}/{image}/manifests/{reference}",
            get(routes::v2::get_manifest)
                .head(routes::v2::head_manifest)
                .put(routes::v2::put_manifest),
        )
        .route(
            "/v2/{org}/{image}/blobs/{digest}",
            get(routes::v2::get_blob).head(routes::v2::head_blob),
        )
        .route(
            "/v2/{org}/{image}/blobs/uploads/",
            post(routes::v2::start_upload),
        )
        .route(
            "/v2/{org}/{image}/blobs/uploads/{upload_id}",
            patch(routes::v2::patch_upload).put(routes::v2::complete_upload),
        )
        .layer(DefaultBodyLimit::max(MAX_REGISTRY_BODY_BYTES))
}

pub async fn build_state(config: &config::RegistryConfig, pool: sqlx::PgPool) -> anyhow::Result<RegistryState> {
    let storage = storage::BlobStore::from_config(config)?;
    if std::env::var("REGISTRY_GC_ENABLED")
        .map(|v| v != "0")
        .unwrap_or(true)
    {
        gc::spawn_gc_loop(pool.clone(), storage.clone());
    }
    Ok(RegistryState {
        pool,
        storage,
        jwt_secret: config.jwt_secret.clone(),
        token_url: config.token_url(),
        service_name: config.service_name.clone(),
    })
}
