use std::sync::Arc;

use anyhow::Context;
use bytes::Bytes;
use futures_util::stream::StreamExt;
use futures_util::SinkExt;
use http::uri::PathAndQuery;
use http::uri::{self, Uri};
use http::{HeaderMap, HeaderName, HeaderValue, Method};
use tokio_quiche::quiche::h3::Header;
use tokio_quiche::quiche::h3::NameValue;
use tokio::net::UdpSocket;
use tokio_quiche::http3::driver::{
    H3Event, IncomingH3Headers, InboundFrame, InboundFrameStream, OutboundFrame,
    OutboundFrameSender, ServerEventStream, ServerH3Event,
};
use tokio_quiche::http3::settings::Http3Settings;
use tokio_quiche::listen;
use tokio_quiche::metrics::DefaultMetrics;
use tokio_quiche::settings::CertificateKind;
use tokio_quiche::settings::Hooks;
use tokio_quiche::settings::QuicSettings;
use tokio_quiche::settings::TlsCertificatePaths;
use tokio_quiche::{ConnectionParams, ServerH3Driver};

use crate::is_hop_by_hop_header;

#[derive(Debug, Clone)]
pub struct H3ProxyConfig {
    pub listen_host: String,
    pub listen_port: u16,
    pub tls_cert_path: String,
    pub tls_key_path: String,
    pub http_upstream: String,
    /// TCP TLS on the same port for browsers (HTTPS). UDP remains HTTP/3.
    pub tcp_enabled: bool,
}

pub async fn run_h3_proxy(config: H3ProxyConfig) -> anyhow::Result<()> {
    let client = crate::upstream::shared_http_client()?;
    let upstream = Arc::new(config.http_upstream.clone());

    crate::upstream::warn_if_upstream_unreachable(&client, &config.http_upstream).await;

    if config.tcp_enabled {
        let tcp_config = config.clone();
        let tcp_client = Arc::clone(&client);
        tokio::spawn(async move {
            if let Err(err) = crate::tcp_proxy::run_tcp_tls_proxy(tcp_config, tcp_client).await {
                tracing::error!("tcp tls proxy exited: {err:#}");
            }
        });
    } else {
        tracing::info!("GATEWAY_H3_TCP=0 — TCP disabled; use curl --http3-only or a client with QUIC");
    }

    let bind_addr = format!("{}:{}", config.listen_host, config.listen_port);
    let socket = UdpSocket::bind(&bind_addr)
        .await
        .with_context(|| format!("bind UDP {bind_addr}"))?;

    let mut listeners = listen(
        [socket],
        ConnectionParams::new_server(
            QuicSettings::default(),
            TlsCertificatePaths {
                cert: &config.tls_cert_path,
                private_key: &config.tls_key_path,
                kind: CertificateKind::X509,
            },
            Hooks::default(),
        ),
        DefaultMetrics,
    )
    .context("start QUIC listener")?;

    tracing::info!(
        "pertisk-h3-gateway HTTP/3 on udp://{bind_addr} -> {}",
        config.http_upstream
    );

    let accepted_connection_stream = &mut listeners[0];
    while let Some(conn_res) = accepted_connection_stream.next().await {
        let conn = match conn_res {
            Ok(conn) => conn,
            Err(err) => {
                tracing::warn!("quic accept failed: {err:#}");
                continue;
            }
        };

        let (driver, mut controller) = ServerH3Driver::new(Http3Settings::default());
        conn.start(driver);

        let client = Arc::clone(&client);
        let upstream = Arc::clone(&upstream);
        tokio::spawn(async move {
            let mut server = ProxyServer::new(client, upstream);
            if let Err(err) = server.serve_connection(controller.event_receiver_mut()).await {
                tracing::debug!("h3 connection closed: {err:#}");
            }
        });
    }

    Ok(())
}

struct ProxyServer {
    client: Arc<reqwest::Client>,
    upstream: Arc<String>,
}

impl ProxyServer {
    fn new(client: Arc<reqwest::Client>, upstream: Arc<String>) -> Self {
        Self { client, upstream }
    }

    async fn serve_connection(
        &mut self,
        h3_event_receiver: &mut ServerEventStream,
    ) -> tokio_quiche::QuicResult<()> {
        loop {
            match h3_event_receiver.recv().await {
                Some(event) => self.handle_server_h3_event(event).await?,
                None => return Ok(()),
            }
        }
    }

    async fn handle_server_h3_event(&mut self, event: ServerH3Event) -> tokio_quiche::QuicResult<()> {
        match event {
            ServerH3Event::Core(event) => match event {
                H3Event::ConnectionError(err) => Err(Box::new(err)),
                H3Event::ConnectionShutdown(_) => return Ok(()),
                _ => Ok(()),
            },
            ServerH3Event::Headers {
                incoming_headers,
                priority: _,
                is_in_early_data: _,
            } => {
                self.handle_incoming_headers(incoming_headers).await;
                Ok(())
            }
        }
    }

    async fn handle_incoming_headers(&self, headers: IncomingH3Headers) {
        let IncomingH3Headers {
            headers: list,
            mut send,
            mut recv,
            read_fin,
            ..
        } = headers;

        let Ok(parsed) = convert_headers(list) else {
            let _ = send_response_error(&mut send, 400, b"invalid request headers").await;
            return;
        };

        let Ok(uri) = parsed.uri_builder.build() else {
            let _ = send_response_error(&mut send, 400, b"invalid request uri").await;
            return;
        };

        let body = if read_fin {
            Bytes::new()
        } else {
            match read_request_body(&mut recv).await {
                Ok(body) => body,
                Err(err) => {
                    tracing::debug!("failed to read h3 request body: {err:#}");
                    let _ = send_response_error(&mut send, 400, b"invalid request body").await;
                    return;
                }
            }
        };

        if let Err(err) = self
            .proxy_request(parsed.method, uri, parsed.headers, body, &mut send)
            .await
        {
            tracing::warn!("h3 proxy request failed: {err:#}");
            let _ = send_response_error(&mut send, 502, b"bad gateway").await;
        }
    }

    async fn proxy_request(
        &self,
        method: Method,
        uri: Uri,
        headers: HeaderMap,
        body: Bytes,
        frame_sender: &mut OutboundFrameSender,
    ) -> anyhow::Result<()> {
        let path_and_query = uri
            .path_and_query()
            .map(PathAndQuery::as_str)
            .unwrap_or("/");

        let (status, response_headers, response_body) = crate::upstream::forward_to_upstream(
            &self.client,
            self.upstream.as_str(),
            method,
            path_and_query,
            &headers,
            body,
        )
        .await?;

        send_response(frame_sender, status, &response_headers, response_body).await
    }
}

async fn read_request_body(recv: &mut InboundFrameStream) -> anyhow::Result<Bytes> {
    let mut body = Vec::new();
    while let Some(frame) = recv.recv().await {
        match frame {
            InboundFrame::Body(chunk, fin) => {
                body.extend_from_slice(&chunk);
                if fin {
                    break;
                }
            }
            InboundFrame::Datagram(_) => {}
        }
    }
    Ok(Bytes::from(body))
}

async fn send_response_error(
    frame_sender: &mut OutboundFrameSender,
    status: u16,
    message: &[u8],
) -> anyhow::Result<()> {
    send_response(
        frame_sender,
        status,
        &http::HeaderMap::new(),
        Bytes::copy_from_slice(message),
    )
    .await
}

async fn send_response(
    frame_sender: &mut OutboundFrameSender,
    status: u16,
    headers: &http::HeaderMap,
    body: Bytes,
) -> anyhow::Result<()> {
    let mut h3_headers = vec![Header::new(b":status", status.to_string().as_bytes())];
    for (name, value) in headers.iter() {
        if is_hop_by_hop_header(name.as_str()) {
            continue;
        }
        h3_headers.push(Header::new(name.as_ref(), value.as_bytes()));
    }

    frame_sender
        .send(OutboundFrame::Headers(h3_headers, None))
        .await
        .context("send h3 response headers")?;

    if body.is_empty() {
        frame_sender
            .send(OutboundFrame::Body(Bytes::new(), true))
            .await
            .context("send h3 response fin")?;
        return Ok(());
    }

    for chunk in body.chunks(tokio_quiche::buf_factory::BufFactory::MAX_BUF_SIZE) {
        frame_sender
            .send(OutboundFrame::Body(Bytes::copy_from_slice(chunk), false))
            .await
            .context("send h3 response body chunk")?;
    }

    frame_sender
        .send(OutboundFrame::Body(Bytes::new(), true))
        .await
        .context("send h3 response fin")?;
    Ok(())
}

struct ParsedRequest {
    uri_builder: uri::Builder,
    method: Method,
    headers: HeaderMap,
}

fn convert_headers(headers: Vec<Header>) -> tokio_quiche::QuicResult<ParsedRequest> {
    let mut method = Method::GET;
    let mut uri_builder = Uri::builder();
    let mut header_map = HeaderMap::new();

    for header in headers {
        let name = header.name();
        let value = header.value();

        let Some(first) = name
            .iter()
            .next()
            .and_then(|f| std::char::from_u32(*f as u32))
        else {
            continue;
        };

        if first == ':' {
            match name {
                b":method" => {
                    method = Method::from_bytes(value)
                        .map_err(|err| -> tokio_quiche::BoxError { err.into() })?;
                }
                b":scheme" => {
                    uri_builder = uri_builder.scheme(value);
                }
                b":authority" => {
                    let host = HeaderValue::from_bytes(value)?;
                    uri_builder = uri_builder.authority(host.as_bytes());
                }
                b":path" => {
                    let path = PathAndQuery::try_from(value)?;
                    uri_builder = uri_builder.path_and_query(path);
                }
                _ => {}
            }
        } else {
            let Ok(name) = HeaderName::from_bytes(name) else {
                continue;
            };
            if is_hop_by_hop_header(name.as_str()) {
                continue;
            }
            let Ok(value) = HeaderValue::from_bytes(value) else {
                continue;
            };
            header_map.insert(name, value);
        }
    }

    Ok(ParsedRequest {
        uri_builder,
        method,
        headers: header_map,
    })
}
