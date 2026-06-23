use async_trait::async_trait;
use bytes::Bytes;
use pingora_core::server::Server;
use pingora_core::upstreams::peer::HttpPeer;
use pingora_core::Result;
use pingora_proxy::{ProxyHttp, Session};

struct GatewayProxy {
    api_upstream: (String, u16),
    git_upstream: (String, u16),
}

#[async_trait]
impl ProxyHttp for GatewayProxy {
    type CTX = ();

    fn new_ctx(&self) -> Self::CTX {}

    async fn request_filter(
        &self,
        session: &mut Session,
        _ctx: &mut Self::CTX,
    ) -> Result<bool> {
        if session.req_header().uri.path() == "/health" {
            session
                .respond_error_with_body(200, Bytes::from_static(b"ok"))
                .await?;
            return Ok(true);
        }
        Ok(false)
    }

    async fn upstream_peer(
        &self,
        session: &mut Session,
        _ctx: &mut Self::CTX,
    ) -> Result<Box<HttpPeer>> {
        let path = session.req_header().uri.path();
        // Git Smart HTTP is served by the API (same upstream). A dedicated git-http
        // process on GIT_UPSTREAM is optional for production scale-out.
        let (host, port) = if path.contains(".git") {
            &self.git_upstream
        } else {
            &self.api_upstream
        };

        let peer = Box::new(HttpPeer::new((host.as_str(), *port), false, host.clone()));
        Ok(peer)
    }
}

fn parse_upstream(value: &str, default_port: u16) -> (String, u16) {
    let value = value
        .trim()
        .strip_prefix("http://")
        .or_else(|| value.strip_prefix("https://"))
        .unwrap_or(value);

    if let Some((host, port)) = value.rsplit_once(':') {
        if let Ok(port) = port.parse::<u16>() {
            return (host.to_string(), port);
        }
    }
    (value.to_string(), default_port)
}

fn main() {
    dotenvy::dotenv().ok();

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info".into()),
        )
        .init();

    let host = std::env::var("GATEWAY_HOST").unwrap_or_else(|_| "0.0.0.0".into());
    let port: u16 = std::env::var("GATEWAY_PORT")
        .unwrap_or_else(|_| "8080".into())
        .parse()
        .expect("GATEWAY_PORT must be a valid u16");
    let api_upstream =
        std::env::var("API_UPSTREAM").unwrap_or_else(|_| "127.0.0.1:8081".into());
    let git_upstream =
        std::env::var("GIT_UPSTREAM").unwrap_or_else(|_| "127.0.0.1:8082".into());

    let api_upstream = parse_upstream(&api_upstream, 8081);
    let git_upstream = parse_upstream(&git_upstream, 8082);

    let mut server = Server::new(None).unwrap();
    server.bootstrap();

    let proxy = GatewayProxy {
        api_upstream: api_upstream.clone(),
        git_upstream: git_upstream.clone(),
    };
    let mut proxy_service = pingora_proxy::http_proxy_service(&server.configuration, proxy);
    proxy_service.add_tcp(&format!("{host}:{port}"));

    server.add_service(proxy_service);
    tracing::info!(
        "pertisk-gateway listening on {host}:{port} (api {}:{}, git {}:{})",
        api_upstream.0,
        api_upstream.1,
        git_upstream.0,
        git_upstream.1
    );
    server.run_forever();
}
