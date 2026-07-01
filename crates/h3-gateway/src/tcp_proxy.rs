use std::fs::File;
use std::io::BufReader;
use std::sync::Arc;

use anyhow::Context;
use bytes::Bytes;
use http_body_util::{BodyExt, Full};
use hyper::body::Incoming;
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use rustls::pki_types::CertificateDer;
use rustls::ServerConfig;
use tokio::net::TcpListener;
use tokio_rustls::TlsAcceptor;

use crate::upstream::forward_to_upstream;
use crate::H3ProxyConfig;

pub async fn run_tcp_tls_proxy(
    config: H3ProxyConfig,
    client: Arc<reqwest::Client>,
) -> anyhow::Result<()> {
    let tls_config = load_tls_config(&config.tls_cert_path, &config.tls_key_path)?;
    let acceptor = TlsAcceptor::from(Arc::new(tls_config));

    let bind_addr = format!("{}:{}", config.listen_host, config.listen_port);
    let listener = TcpListener::bind(&bind_addr)
        .await
        .with_context(|| format!("bind TCP {bind_addr}"))?;

    tracing::info!(
        "pertisk-h3-gateway TCP TLS on https://{bind_addr} (browser) -> {}",
        config.http_upstream
    );

    loop {
        let (stream, _) = listener.accept().await.context("accept TCP connection")?;
        let acceptor = acceptor.clone();
        let client = Arc::clone(&client);
        let upstream = config.http_upstream.clone();
        let listen_port = config.listen_port;

        tokio::spawn(async move {
            let tls_stream = match acceptor.accept(stream).await {
                Ok(stream) => stream,
                Err(err) => {
                    tracing::debug!("tls handshake failed: {err:#}");
                    return;
                }
            };

            let service = service_fn(move |req| {
                let client = Arc::clone(&client);
                let upstream = upstream.clone();
                async move { Ok::<_, hyper::Error>(handle_request(req, client, upstream, listen_port).await) }
            });

            let io = TokioIo::new(tls_stream);
            if let Err(err) = http1::Builder::new().serve_connection(io, service).await {
                tracing::debug!("tcp http connection ended: {err:#}");
            }
        });
    }
}

async fn handle_request(
    req: Request<Incoming>,
    client: Arc<reqwest::Client>,
    upstream: String,
    listen_port: u16,
) -> Response<Full<Bytes>> {
    let (parts, body) = req.into_parts();
    let path_and_query = parts
        .uri
        .path_and_query()
        .map(|pq| pq.as_str())
        .unwrap_or("/")
        .to_string();

    let body = match body.collect().await {
        Ok(collected) => collected.to_bytes(),
        Err(err) => {
            tracing::debug!("read request body failed: {err:#}");
            return Response::builder()
                .status(StatusCode::BAD_REQUEST)
                .body(Full::new(Bytes::from_static(b"invalid request body")))
                .unwrap();
        }
    };

    match forward_to_upstream(
        &client,
        &upstream,
        parts.method,
        &path_and_query,
        &parts.headers,
        body,
    )
    .await
    {
        Ok((status, mut headers, response_body)) => {
            let alt_svc = format!(r#"h3=":{listen_port}"; ma=86400"#);
            if let Ok(value) = http::HeaderValue::from_str(&alt_svc) {
                headers.insert(http::HeaderName::from_static("alt-svc"), value);
            }
            let mut builder = Response::builder().status(status);
            for (name, value) in headers.iter() {
                builder = builder.header(name, value);
            }
            builder
                .body(Full::new(response_body))
                .unwrap_or_else(|_| {
                    Response::builder()
                        .status(StatusCode::INTERNAL_SERVER_ERROR)
                        .body(Full::new(Bytes::from_static(b"response build failed")))
                        .unwrap()
                })
        }
        Err(err) => {
            tracing::warn!("tcp proxy request failed: {err:#}");
            Response::builder()
                .status(StatusCode::BAD_GATEWAY)
                .body(Full::new(Bytes::from_static(b"bad gateway")))
                .unwrap()
        }
    }
}

fn load_tls_config(cert_path: &str, key_path: &str) -> anyhow::Result<ServerConfig> {
    let cert_file = File::open(cert_path)
        .with_context(|| format!("open certificate {cert_path}"))?;
    let key_file = File::open(key_path)
        .with_context(|| format!("open private key {key_path}"))?;

    let certs: Vec<CertificateDer<'static>> = rustls_pemfile::certs(&mut BufReader::new(cert_file))
        .collect::<Result<Vec<_>, _>>()
        .context("read certificate PEM")?;
    let key = rustls_pemfile::private_key(&mut BufReader::new(key_file))
        .context("read private key PEM")?
        .ok_or_else(|| anyhow::anyhow!("no private key in {key_path}"))?;

    ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(certs, key)
        .context("build rustls server config")
}
