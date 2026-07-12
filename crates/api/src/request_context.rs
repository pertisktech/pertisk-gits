use axum::http::HeaderMap;

#[derive(Debug, Clone, Default)]
pub struct LoginContext {
    pub ip_address: Option<String>,
    pub user_agent: Option<String>,
}

impl LoginContext {
    pub fn from_headers(headers: &HeaderMap) -> Self {
        Self {
            ip_address: client_ip(headers),
            user_agent: user_agent(headers),
        }
    }
}

pub fn client_ip(headers: &HeaderMap) -> Option<String> {
    headers
        .get("x-forwarded-for")
        .or_else(|| headers.get("x-real-ip"))
        .and_then(|value| value.to_str().ok())
        .map(|value| value.split(',').next().unwrap_or(value).trim().to_string())
        .filter(|ip| !ip.is_empty())
}

pub fn user_agent(headers: &HeaderMap) -> Option<String> {
    headers
        .get("user-agent")
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|ua| !ua.is_empty())
        .map(str::to_string)
}
