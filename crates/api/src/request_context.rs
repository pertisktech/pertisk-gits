use std::net::{IpAddr, SocketAddr};

use axum::http::HeaderMap;

#[derive(Debug, Clone, Default)]
pub struct LoginContext {
    pub ip_address: Option<String>,
    pub user_agent: Option<String>,
}

impl LoginContext {
    pub fn from_headers(headers: &HeaderMap) -> Self {
        Self::from_parts(headers, None)
    }

    pub fn from_parts(headers: &HeaderMap, peer_addr: Option<SocketAddr>) -> Self {
        Self {
            ip_address: client_ip(headers, peer_addr),
            user_agent: user_agent(headers),
        }
    }
}

pub fn client_ip(headers: &HeaderMap, peer_addr: Option<SocketAddr>) -> Option<String> {
    if let Some(ip) = client_ip_from_headers(headers) {
        if !is_loopback_ip(&ip) {
            return Some(ip);
        }
    }

    peer_addr
        .map(|addr| addr.ip())
        .filter(|ip| !ip.is_loopback() && !is_private_socket_ip(ip))
        .map(|ip| ip.to_string())
}

fn is_loopback_ip(ip: &str) -> bool {
    let ip = ip.trim();
    ip == "::1" || ip == "127.0.0.1"
}

fn is_private_socket_ip(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => v4.is_private() || v4.is_link_local(),
        IpAddr::V6(v6) => v6.is_unique_local() || v6.is_unicast_link_local(),
    }
}

fn client_ip_from_headers(headers: &HeaderMap) -> Option<String> {
    for header in [
        "cf-connecting-ip",
        "true-client-ip",
        "x-client-ip",
        "x-original-forwarded-for",
        "x-forwarded-for",
        "x-real-ip",
    ] {
        if let Some(value) = headers
            .get(header)
            .and_then(|value| value.to_str().ok())
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            if header == "x-forwarded-for" {
                if let Some(ip) = value.split(',').next().map(str::trim).filter(|ip| !ip.is_empty())
                {
                    return Some(normalize_ip_string(ip));
                }
            } else {
                return Some(normalize_ip_string(value));
            }
        }
    }

    headers
        .get("forwarded")
        .and_then(|value| value.to_str().ok())
        .and_then(parse_forwarded_for)
}

fn parse_forwarded_for(value: &str) -> Option<String> {
    for part in value.split(',') {
        for segment in part.split(';') {
            let segment = segment.trim();
            let Some((key, raw)) = segment.split_once('=') else {
                continue;
            };
            if key.trim().eq_ignore_ascii_case("for") {
                let ip = raw.trim().trim_matches('"');
                let ip = ip
                    .strip_prefix('[')
                    .and_then(|inner| inner.strip_suffix(']'))
                    .unwrap_or(ip);
                if !ip.is_empty() {
                    return Some(normalize_ip_string(ip));
                }
            }
        }
    }
    None
}

fn normalize_ip_string(value: &str) -> String {
    value.trim().trim_matches('"').to_string()
}

pub fn user_agent(headers: &HeaderMap) -> Option<String> {
    headers
        .get("user-agent")
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|ua| !ua.is_empty())
        .map(str::to_string)
}

pub fn is_private_ip(ip: &str) -> bool {
    let ip = ip.trim();
    if ip == "::1" || ip == "127.0.0.1" {
        return true;
    }
    if let Ok(parsed) = ip.parse::<IpAddr>() {
        return parsed.is_loopback()
            || parsed.is_unspecified()
            || match parsed {
                IpAddr::V4(v4) => v4.is_private() || v4.is_link_local(),
                IpAddr::V6(v6) => v6.is_unique_local() || v6.is_unicast_link_local(),
            };
    }

    ip.starts_with("10.")
        || ip.starts_with("192.168.")
        || ip.starts_with("172.16.")
        || ip.starts_with("172.17.")
        || ip.starts_with("172.18.")
        || ip.starts_with("172.19.")
        || ip.starts_with("172.2")
        || ip.starts_with("172.30.")
        || ip.starts_with("172.31.")
        || ip.starts_with("fc")
        || ip.starts_with("fd")
        || ip.starts_with("fe80:")
}

pub fn location_label(ip: &str) -> String {
    match ip {
        "Unknown" | "Unavailable" => "Unknown".into(),
        ip if is_private_ip(ip) => "Local network".into(),
        _ => "Unknown".into(),
    }
}

pub fn display_client_ip(ip: Option<String>) -> String {
    ip.filter(|value| !value.is_empty())
        .unwrap_or_else(|| "Unavailable".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefers_forwarded_client_ip_header() {
        let mut headers = HeaderMap::new();
        headers.insert("x-forwarded-for", "203.0.113.10, 10.0.0.1".parse().unwrap());
        headers.insert("x-real-ip", "198.51.100.2".parse().unwrap());
        assert_eq!(
            client_ip_from_headers(&headers).as_deref(),
            Some("203.0.113.10")
        );
    }

    #[test]
    fn parses_forwarded_header() {
        let mut headers = HeaderMap::new();
        headers.insert(
            "forwarded",
            r#"for="203.0.113.60";proto=https;by="203.0.113.43""#.parse().unwrap(),
        );
        assert_eq!(
            client_ip_from_headers(&headers).as_deref(),
            Some("203.0.113.60")
        );
    }

    #[test]
    fn ignores_loopback_peer_without_forwarded_header() {
        let headers = HeaderMap::new();
        let peer: SocketAddr = "127.0.0.1:8080".parse().unwrap();
        assert_eq!(client_ip(&headers, Some(peer)), None);
    }

    #[test]
    fn falls_back_to_public_peer_address() {
        let headers = HeaderMap::new();
        let peer: SocketAddr = "203.0.113.44:54321".parse().unwrap();
        assert_eq!(
            client_ip(&headers, Some(peer)).as_deref(),
            Some("203.0.113.44")
        );
    }
}
