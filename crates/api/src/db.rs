use sqlx::postgres::PgPoolOptions;

pub async fn connect(database_url: &str) -> anyhow::Result<sqlx::PgPool> {
    let pool = PgPoolOptions::new()
        .max_connections(10)
        .connect(database_url)
        .await?;
    Ok(pool)
}

/// After `psql --clean` / `pg_restore` the live pool keeps stale prepared statements and
/// PostgreSQL returns `cached plan must not change result type`. Exit so systemd/k8s restarts
/// the process with a new pool (see `build/pertisk-gits.service` `Restart=always`).
pub fn schedule_restart_after_schema_change(reason: &str) {
    tracing::warn!(
        "{reason}; exiting in 1s so the service manager can restart with a fresh connection pool"
    );
    tokio::spawn(async {
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        std::process::exit(0);
    });
}
