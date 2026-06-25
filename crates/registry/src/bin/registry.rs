use axum::extract::DefaultBodyLimit;
use sqlx::postgres::PgPoolOptions;
use tower_http::trace::TraceLayer;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,pertisk_registry=debug".into()),
        )
        .init();

    let config = pertisk_registry::config::RegistryConfig::from_env()?;
    let pool = PgPoolOptions::new()
        .max_connections(10)
        .connect(&config.database_url)
        .await?;
    sqlx::migrate!("../../migrations").run(&pool).await?;

    let state = pertisk_registry::build_state(&config, pool).await?;
    let app = pertisk_registry::router()
        .layer(DefaultBodyLimit::max(pertisk_registry::MAX_REGISTRY_BODY_BYTES))
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let addr = format!("{}:{}", config.host, config.port);
    tracing::info!("pertisk-registry listening on {addr}");
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}
