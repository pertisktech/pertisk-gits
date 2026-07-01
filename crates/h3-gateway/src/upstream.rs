use std::sync::Arc;

use anyhow::Context;
use bytes::Bytes;
use http::{HeaderMap, Method};

use crate::{build_upstream_url, is_hop_by_hop_header};

pub async fn forward_to_upstream(
    client: &reqwest::Client,
    upstream: &str,
    method: Method,
    path_and_query: &str,
    headers: &HeaderMap,
    body: Bytes,
) -> anyhow::Result<(u16, HeaderMap, Bytes)> {
    let upstream_url = build_upstream_url(upstream, path_and_query);

    let mut builder = client.request(method, upstream_url);
    for (name, value) in headers.iter() {
        if is_hop_by_hop_header(name.as_str()) {
            continue;
        }
        builder = builder.header(name, value);
    }

    let response = builder
        .body(body)
        .send()
        .await
        .context("upstream request failed")?;

    let status = response.status().as_u16();
    let mut response_headers = HeaderMap::new();
    for (name, value) in response.headers().iter() {
        if is_hop_by_hop_header(name.as_str()) {
            continue;
        }
        if let (Ok(name), Ok(value)) = (
            http::HeaderName::from_bytes(name.as_str().as_bytes()),
            http::HeaderValue::from_bytes(value.as_bytes()),
        ) {
            response_headers.insert(name, value);
        }
    }
    let response_body = response
        .bytes()
        .await
        .context("read upstream response body")?;

    Ok((status, response_headers, response_body))
}

pub fn shared_http_client() -> anyhow::Result<Arc<reqwest::Client>> {
    Ok(Arc::new(
        reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .context("build HTTP client")?,
    ))
}

pub async fn warn_if_upstream_unreachable(client: &reqwest::Client, upstream: &str) {
    let health_url = build_upstream_url(upstream, "/health");
    match client.get(&health_url).send().await {
        Ok(res) if res.status().is_success() => {
            tracing::info!("upstream healthy at {health_url}");
        }
        Ok(res) => {
            tracing::warn!(
                "upstream {health_url} returned {} — check pertisk-api is running",
                res.status()
            );
        }
        Err(err) => {
            tracing::warn!(
                "upstream {health_url} unreachable ({err:#}) — start the API first: `make run` (listens on API_PORT, default 8080)"
            );
        }
    }
}
