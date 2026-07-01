use pertisk_h3_gateway::{run_h3_proxy, H3ProxyConfig};

use anyhow::Context;

fn tcp_enabled_from_env() -> bool {
    match std::env::var("GATEWAY_H3_TCP").ok().as_deref() {
        Some("0") | Some("false") | Some("FALSE") => false,
        _ => true,
    }
}

fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();

    rustls::crypto::ring::default_provider()
        .install_default()
        .expect("rustls crypto provider");

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info".into()),
        )
        .init();

    let tls_cert_path = std::env::var("GATEWAY_H3_CERT").context(
        "GATEWAY_H3_CERT is required (path to TLS certificate PEM). \
         Run `make run-h3-gateway` or set GATEWAY_H3_CERT in .env. \
         Note: `sudo` does not pass exported shell variables — use make without sudo on port 8443.",
    )?;
    let tls_key_path = std::env::var("GATEWAY_H3_KEY").context(
        "GATEWAY_H3_KEY is required (path to TLS private key PEM)",
    )?;

    let config = H3ProxyConfig {
        listen_host: std::env::var("GATEWAY_H3_HOST").unwrap_or_else(|_| "0.0.0.0".into()),
        listen_port: std::env::var("GATEWAY_H3_PORT")
            .unwrap_or_else(|_| "8443".into())
            .parse()
            .context("GATEWAY_H3_PORT must be a valid u16")?,
        tls_cert_path,
        tls_key_path,
        http_upstream: std::env::var("GATEWAY_HTTP_UPSTREAM")
            .unwrap_or_else(|_| "http://127.0.0.1:8080".into()),
        tcp_enabled: tcp_enabled_from_env(),
    };

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .context("tokio runtime")?;

    if let Err(err) = runtime.block_on(run_h3_proxy(config)) {
        tracing::error!("pertisk-h3-gateway exited: {err:#}");
        std::process::exit(1);
    }
    Ok(())
}
