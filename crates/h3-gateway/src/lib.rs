mod proxy;
mod tcp_proxy;
mod upstream;

pub use proxy::{run_h3_proxy, H3ProxyConfig};

pub fn normalize_http_upstream(value: &str) -> String {
    let trimmed = value.trim().trim_end_matches('/');
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else {
        format!("http://{trimmed}")
    }
}

pub fn build_upstream_url(upstream: &str, path_and_query: &str) -> String {
    let base = normalize_http_upstream(upstream);
    if path_and_query.starts_with('/') {
        format!("{base}{path_and_query}")
    } else {
        format!("{base}/{path_and_query}")
    }
}

pub fn is_hop_by_hop_header(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        "connection"
            | "keep-alive"
            | "proxy-authenticate"
            | "proxy-authorization"
            | "te"
            | "trailers"
            | "transfer-encoding"
            | "upgrade"
            | "host"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_http_upstream_adds_scheme() {
        assert_eq!(
            normalize_http_upstream("127.0.0.1:8080"),
            "http://127.0.0.1:8080"
        );
        assert_eq!(
            normalize_http_upstream("http://api:8080/"),
            "http://api:8080"
        );
    }

    #[test]
    fn build_upstream_url_joins_path() {
        assert_eq!(
            build_upstream_url("http://127.0.0.1:8080", "/api/v1/health"),
            "http://127.0.0.1:8080/api/v1/health"
        );
    }

    #[test]
    fn hop_by_hop_headers_filtered() {
        assert!(is_hop_by_hop_header("Transfer-Encoding"));
        assert!(!is_hop_by_hop_header("content-type"));
    }
}
