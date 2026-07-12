use axum::{
    extract::{ConnectInfo, Path, Query, State},
    response::IntoResponse,
    Json,
};
use std::net::SocketAddr;
use base64::Engine;
use jsonwebtoken::{decode, decode_header, Algorithm, DecodingKey, Validation};
use pertisk_domain::models::{AuditEventType, AuthProvider, AuthProviderType, AuthResponse};
use pertisk_domain::DomainError;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use uuid::Uuid;

use super::{
    api_callback_url, browser_login_error_response, browser_redirect_response,
    browser_session_response, ensure_enabled_provider, issue_auth_response, jit_provision_user,
    load_provider, random_token, store_flow_state, take_flow_state, ExternalUser, SsoHtmlPage,
};
use crate::{
    audit::{record_audit_event, AuditEventInput},
    ApiError, AppState,
};

#[derive(Deserialize)]
pub struct OidcCallbackQuery {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
}

#[derive(Deserialize)]
struct OidcDiscovery {
    authorization_endpoint: String,
    token_endpoint: String,
}

#[derive(Deserialize)]
struct OidcTokenResponse {
    id_token: Option<String>,
    access_token: Option<String>,
}

#[derive(Clone, Deserialize)]
struct OidcIdClaims {
    sub: String,
    email: Option<String>,
    preferred_username: Option<String>,
    name: Option<String>,
}

#[derive(Deserialize)]
pub struct OidcSessionRequest {
    id_token: String,
    access_token: Option<String>,
}

#[derive(Deserialize)]
struct OidcUserInfo {
    sub: String,
    email: Option<String>,
    name: Option<String>,
    preferred_username: Option<String>,
}

#[derive(Clone, Deserialize)]
struct OidcJwk {
    kid: Option<String>,
    n: Option<String>,
    e: Option<String>,
}

#[derive(Deserialize)]
struct OidcJwks {
    keys: Vec<OidcJwk>,
}

struct OidcJwksCacheEntry {
    fetched_at: Instant,
    keys: Vec<OidcJwk>,
}

const OIDC_JWKS_TTL_SECS: u64 = 3600;

fn oidc_jwks_cache() -> &'static Mutex<HashMap<String, OidcJwksCacheEntry>> {
    static CACHE: OnceLock<Mutex<HashMap<String, OidcJwksCacheEntry>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

pub async fn start_oidc_login(
    state: &AppState,
    provider_id: Uuid,
) -> Result<impl IntoResponse, ApiError> {
    let provider = load_provider(&state.pool, provider_id).await?;
    ensure_enabled_provider(&provider)?;
    if provider.provider_type != AuthProviderType::Oidc {
        return Err(DomainError::Validation("provider is not OIDC".into()).into());
    }

    let issuer = provider.issuer_url.as_deref().ok_or(
        DomainError::Validation("missing issuer_url".into()),
    )?;
    let discovery = fetch_discovery(issuer).await?;

    let verifier = random_token(32);
    let challenge = pkce_challenge(&verifier);
    let flow_state = store_flow_state(
        &state.pool,
        provider.id,
        Some(verifier),
        None,
        None,
    )
    .await?;

    let client_id = provider
        .client_id
        .as_deref()
        .ok_or(DomainError::Validation("missing client_id".into()))?;
    let redirect_uri = api_callback_url(state, "/auth/oidc/callback");

    let mut auth_url = reqwest::Url::parse(&discovery.authorization_endpoint).map_err(|e| {
        ApiError::from(DomainError::Internal(format!(
            "invalid authorization_endpoint from discovery: {e}"
        )))
    })?;
    {
        let mut query = auth_url.query_pairs_mut();
        query.append_pair("response_type", "code");
        query.append_pair("client_id", client_id);
        query.append_pair("redirect_uri", &redirect_uri);
        query.append_pair("scope", provider.scopes.as_str());
        query.append_pair("state", &flow_state);
        query.append_pair("code_challenge", &challenge);
        query.append_pair("code_challenge_method", "S256");
        query.append_pair("prompt", "login select_account");
    }
    Ok(browser_redirect_response(&auth_url.to_string()).into_response())
}

pub async fn oidc_logout(
    State(state): State<AppState>,
    Path(provider_id): Path<Uuid>,
) -> Result<impl IntoResponse, ApiError> {
    let provider = load_provider(&state.pool, provider_id).await?;
    ensure_enabled_provider(&provider)?;
    if provider.provider_type != AuthProviderType::Oidc {
        return Err(DomainError::Validation("provider is not OIDC".into()).into());
    }

    let issuer = provider
        .issuer_url
        .as_deref()
        .ok_or(DomainError::Validation("missing issuer_url".into()))?;
    let issuer = normalize_issuer_url(issuer)?;
    let client_id = provider
        .client_id
        .as_deref()
        .ok_or(DomainError::Validation("missing client_id".into()))?;
    let return_to = format!("{}/login", super::public_base_url(&state));
    let logout_url = format!(
        "{issuer}/v2/logout?client_id={}&returnTo={}",
        urlencoding::encode(client_id),
        urlencoding::encode(&return_to),
    );

    Ok(super::browser_redirect_response(&logout_url).into_response())
}

pub async fn oidc_callback(
    State(state): State<AppState>,
    ConnectInfo(peer_addr): ConnectInfo<SocketAddr>,
    headers: axum::http::HeaderMap,
    Query(query): Query<OidcCallbackQuery>,
) -> impl IntoResponse {
    let login_ctx = crate::request_context::LoginContext::from_parts(&headers, Some(peer_addr));
    match oidc_callback_inner(&state, query, login_ctx).await {
        Ok(page) => page.into_response(),
        Err(err) => browser_login_error_response(&state, &err.user_message()).into_response(),
    }
}

async fn oidc_callback_inner(
    state: &AppState,
    query: OidcCallbackQuery,
    login_ctx: crate::request_context::LoginContext,
) -> Result<SsoHtmlPage, ApiError> {
    if let Some(error) = query.error {
        let message = query
            .error_description
            .unwrap_or(error)
            .replace('+', " ");
        return Ok(browser_login_error_response(state, &message));
    }

    let code = query
        .code
        .ok_or(DomainError::Validation("missing authorization code".into()))?;
    let state_param = query
        .state
        .ok_or(DomainError::Validation("missing OAuth state".into()))?;

    let flow = take_flow_state(&state.pool, &state_param).await?;
    let provider = load_provider(&state.pool, flow.provider_id).await?;
    ensure_enabled_provider(&provider)?;

    let issuer = provider.issuer_url.as_deref().ok_or(
        DomainError::Validation("missing issuer_url".into()),
    )?;
    let discovery = fetch_discovery(issuer).await?;

    let client_id = provider
        .client_id
        .as_deref()
        .ok_or(DomainError::Validation("missing client_id".into()))?;
    let redirect_uri = api_callback_url(state, "/auth/oidc/callback");
    let verifier = flow
        .code_verifier
        .ok_or(DomainError::Validation("missing PKCE verifier".into()))?;

    let body = if provider.client_secret.as_ref().is_some_and(|s| !s.is_empty()) {
        format!(
            "grant_type=authorization_code&code={}&redirect_uri={}&code_verifier={}",
            urlencoding::encode(&code),
            urlencoding::encode(&redirect_uri),
            urlencoding::encode(&verifier),
        )
    } else {
        format!(
            "grant_type=authorization_code&code={}&redirect_uri={}&client_id={}&code_verifier={}",
            urlencoding::encode(&code),
            urlencoding::encode(&redirect_uri),
            urlencoding::encode(client_id),
            urlencoding::encode(&verifier),
        )
    };

    let http = reqwest::Client::new();
    let mut request = http
        .post(&discovery.token_endpoint)
        .header("Accept", "application/json")
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(body);

    if let Some(secret) = provider.client_secret.as_ref().filter(|s| !s.is_empty()) {
        request = request.basic_auth(client_id, Some(secret.as_str()));
    }

    let token_response = request
        .send()
        .await
        .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?
        .error_for_status()
        .map_err(|_| DomainError::Unauthorized)?
        .json::<OidcTokenResponse>()
        .await
        .map_err(|_| DomainError::Unauthorized)?;

    let id_token = token_response
        .id_token
        .ok_or(DomainError::Unauthorized)?;
    let claims = decode_id_token_claims(&id_token)?;
    let external = external_user_from_oidc(
        &provider,
        claims,
        token_response.access_token.as_deref(),
    )
    .await?;

    let user = jit_provision_user(&state.pool, &provider, &external).await?;

    record_audit_event(
        &state.pool,
        AuditEventInput {
            organization_id: None,
            actor_user_id: Some(user.id),
            event_type: AuditEventType::SsoLogin,
            action: format!("oidc login via {}", provider.name),
            resource_type: Some("auth_provider".into()),
            resource_id: Some(provider.id.to_string()),
            metadata: Some(serde_json::json!({
                "provider_type": "oidc",
                "email": external.email,
                "subject": external.subject,
            })),
            ip_address: None,
            user_agent: None,
        },
    )
    .await?;

    let auth = issue_auth_response(state, user, "oidc", login_ctx).await?;
    Ok(browser_session_response(state, &auth))
}

pub async fn oidc_session(
    State(state): State<AppState>,
    ConnectInfo(peer_addr): ConnectInfo<SocketAddr>,
    headers: axum::http::HeaderMap,
    Path(provider_id): Path<Uuid>,
    Json(body): Json<OidcSessionRequest>,
) -> Result<Json<AuthResponse>, ApiError> {
    let provider = load_provider(&state.pool, provider_id).await?;
    ensure_enabled_provider(&provider)?;
    if provider.provider_type != AuthProviderType::Oidc {
        return Err(DomainError::Validation("provider is not OIDC".into()).into());
    }

    let claims = verify_id_token_for_provider(&provider, &body.id_token).await?;
    let external =
        external_user_from_oidc(&provider, claims, body.access_token.as_deref()).await?;

    let user = jit_provision_user(&state.pool, &provider, &external).await?;

    record_audit_event(
        &state.pool,
        AuditEventInput {
            organization_id: None,
            actor_user_id: Some(user.id),
            event_type: AuditEventType::SsoLogin,
            action: format!("oidc spa login via {}", provider.name),
            resource_type: Some("auth_provider".into()),
            resource_id: Some(provider.id.to_string()),
            metadata: Some(serde_json::json!({
                "provider_type": "oidc",
                "email": external.email,
                "subject": external.subject,
            })),
            ip_address: None,
            user_agent: None,
        },
    )
    .await?;

    let login_ctx = crate::request_context::LoginContext::from_parts(&headers, Some(peer_addr));
    Ok(Json(
        issue_auth_response(&state, user, "oidc", login_ctx).await?,
    ))
}

/// Extract the OIDC host from issuer_url (e.g. `dev-xxx.auth0.com`).
pub fn issuer_to_oidc_domain(issuer_url: &str) -> Result<String, DomainError> {
    let normalized = normalize_issuer_url(issuer_url)?;
    let url = reqwest::Url::parse(&normalized).map_err(|_| {
        DomainError::Validation(format!("invalid issuer_url host (got {issuer_url:?})"))
    })?;
    url.host_str()
        .map(|host| host.to_ascii_lowercase())
        .ok_or_else(|| DomainError::Validation("issuer_url missing host".into()))
}

async fn verify_id_token_for_provider(
    provider: &AuthProvider,
    id_token: &str,
) -> Result<OidcIdClaims, ApiError> {
    let issuer = provider
        .issuer_url
        .as_deref()
        .ok_or(DomainError::Validation("missing issuer_url".into()))?;
    let issuer = normalize_issuer_url(issuer)?;
    let client_id = provider
        .client_id
        .as_deref()
        .ok_or(DomainError::Validation("missing client_id".into()))?;

    let domain = issuer_to_oidc_domain(&issuer)?;
    let header = decode_header(id_token).map_err(|_| DomainError::Unauthorized)?;
    if header.alg != Algorithm::RS256 {
        return Err(DomainError::Unauthorized.into());
    }
    let kid = header
        .kid
        .as_deref()
        .ok_or(DomainError::Unauthorized)?;

    let key = oidc_decoding_key(&domain, kid).await?;
    let mut validation = Validation::new(Algorithm::RS256);
    validation.validate_exp = true;
    validation.set_audience(&[client_id]);
    let issuer_with_slash = format!("{issuer}/");
    validation.set_issuer(&[issuer_with_slash.as_str()]);

    decode::<OidcIdClaims>(id_token, &key, &validation)
        .map(|data| data.claims)
        .map_err(|_| DomainError::Unauthorized.into())
}

async fn fetch_oidc_jwks(domain: &str) -> Result<Vec<OidcJwk>, ApiError> {
    let url = format!("https://{domain}/.well-known/jwks.json");
    let resp = reqwest::get(url)
        .await
        .map_err(|e| ApiError::from(DomainError::Internal(format!("JWKS fetch failed: {e}"))))?;
    if !resp.status().is_success() {
        return Err(ApiError::from(DomainError::Internal(format!(
            "JWKS fetch returned HTTP {}",
            resp.status()
        ))));
    }
    resp.json::<OidcJwks>()
        .await
        .map(|jwks| jwks.keys)
        .map_err(|e| ApiError::from(DomainError::Internal(format!("invalid JWKS response: {e}"))))
}

async fn oidc_decoding_key(domain: &str, kid: &str) -> Result<DecodingKey, ApiError> {
    let domain_key = domain.trim().trim_end_matches('/').to_ascii_lowercase();
    let now = Instant::now();

    if let Ok(cache) = oidc_jwks_cache().lock() {
        if let Some(entry) = cache.get(&domain_key) {
            if now.duration_since(entry.fetched_at) <= Duration::from_secs(OIDC_JWKS_TTL_SECS) {
                if let Some(found) = entry
                    .keys
                    .iter()
                    .find(|k| k.kid.as_deref() == Some(kid) && k.n.is_some() && k.e.is_some())
                {
                    return DecodingKey::from_rsa_components(
                        found.n.as_deref().unwrap_or_default(),
                        found.e.as_deref().unwrap_or_default(),
                    )
                    .map_err(|_| DomainError::Unauthorized.into());
                }
            }
        }
    }

    let keys = fetch_oidc_jwks(&domain_key).await?;
    if let Ok(mut cache) = oidc_jwks_cache().lock() {
        cache.insert(
            domain_key.clone(),
            OidcJwksCacheEntry {
                fetched_at: now,
                keys: keys.clone(),
            },
        );
    }

    let found = keys
        .iter()
        .find(|k| k.kid.as_deref() == Some(kid) && k.n.is_some() && k.e.is_some())
        .ok_or(DomainError::Unauthorized)?;
    DecodingKey::from_rsa_components(
        found.n.as_deref().unwrap_or_default(),
        found.e.as_deref().unwrap_or_default(),
    )
    .map_err(|_| DomainError::Unauthorized.into())
}

/// Normalize OIDC issuer URLs from admin input (trim, default https, strip discovery suffix).
pub(crate) fn normalize_issuer_url(issuer_url: &str) -> Result<String, DomainError> {
    let trimmed = issuer_url.trim();
    if trimmed.is_empty() {
        return Err(DomainError::Validation("issuer_url is empty".into()));
    }

    let issuer = trimmed
        .trim_end_matches('/')
        .strip_suffix("/.well-known/openid-configuration")
        .unwrap_or(trimmed)
        .trim_end_matches('/');

    let with_scheme = if issuer.contains("://") {
        issuer.to_string()
    } else {
        format!("https://{issuer}")
    };

    reqwest::Url::parse(&with_scheme).map_err(|_| {
        DomainError::Validation(format!(
            "invalid issuer_url — use https://your-tenant.auth0.com (got {issuer_url:?})"
        ))
    })?;

    Ok(with_scheme)
}

async fn fetch_discovery(issuer_url: &str) -> Result<OidcDiscovery, ApiError> {
    let issuer = normalize_issuer_url(issuer_url)?;
    let discovery_url = format!("{issuer}/.well-known/openid-configuration");
    let discovery_url = reqwest::Url::parse(&discovery_url).map_err(|e| {
        ApiError::from(DomainError::Internal(format!(
            "invalid OIDC discovery URL: {e}"
        )))
    })?;

    let http = reqwest::Client::new();
    http.get(discovery_url)
        .send()
        .await
        .map_err(|e| map_oidc_http_error("OIDC discovery request failed", e))?
        .error_for_status()
        .map_err(|e| ApiError::from(DomainError::Internal(format!(
            "OIDC discovery returned error: {e}"
        ))))?
        .json::<OidcDiscovery>()
        .await
        .map_err(|e| ApiError::from(DomainError::Internal(format!(
            "OIDC discovery response invalid: {e}"
        ))))
}

fn map_oidc_http_error(context: &str, err: reqwest::Error) -> ApiError {
    if err.is_builder() {
        return ApiError::from(DomainError::Validation(format!(
            "{context}: invalid URL (issuer_url must start with https://)"
        )));
    }
    ApiError::from(DomainError::Internal(format!("{context}: {err}")))
}

fn pkce_challenge(verifier: &str) -> String {
    let digest = Sha256::digest(verifier.as_bytes());
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(digest)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_issuer_url_adds_https_scheme() {
        assert_eq!(
            normalize_issuer_url("tenant.auth0.com").unwrap(),
            "https://tenant.auth0.com"
        );
    }

    #[test]
    fn normalize_issuer_url_trims_and_strips_discovery_suffix() {
        assert_eq!(
            normalize_issuer_url(" https://tenant.auth0.com/.well-known/openid-configuration ")
                .unwrap(),
            "https://tenant.auth0.com"
        );
    }

    #[test]
    fn normalize_issuer_url_rejects_empty() {
        assert!(normalize_issuer_url("  ").is_err());
    }
}

fn decode_id_token_claims(id_token: &str) -> Result<OidcIdClaims, ApiError> {
    let payload = id_token
        .split('.')
        .nth(1)
        .ok_or(DomainError::Unauthorized)?;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload)
        .or_else(|_| base64::engine::general_purpose::STANDARD.decode(payload))
        .map_err(|_| DomainError::Unauthorized)?;
    serde_json::from_slice(&bytes).map_err(|_| DomainError::Unauthorized.into())
}

async fn fetch_oidc_userinfo(issuer_url: &str, access_token: &str) -> Result<OidcUserInfo, ApiError> {
    let issuer = normalize_issuer_url(issuer_url)?;
    let url = format!("{issuer}/userinfo");
    let resp = reqwest::Client::new()
        .get(&url)
        .bearer_auth(access_token)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| ApiError::from(DomainError::Internal(format!("userinfo request failed: {e}"))))?;
    if !resp.status().is_success() {
        return Err(ApiError::from(DomainError::Internal(format!(
            "userinfo returned HTTP {}",
            resp.status()
        ))));
    }
    resp.json::<OidcUserInfo>()
        .await
        .map_err(|e| ApiError::from(DomainError::Internal(format!("invalid userinfo response: {e}"))))
}

fn usable_oidc_email(email: Option<String>) -> Option<String> {
    email
        .map(|value| super::normalize_email(&value))
        .filter(|value| !value.is_empty() && !super::is_placeholder_sso_email(value))
}

pub(crate) async fn external_user_from_oidc(
    provider: &AuthProvider,
    claims: OidcIdClaims,
    access_token: Option<&str>,
) -> Result<ExternalUser, ApiError> {
    let mut email = usable_oidc_email(claims.email.clone());

    if email.is_none() {
        if let Some(token) = access_token.filter(|value| !value.is_empty()) {
            if let Some(issuer) = provider.issuer_url.as_deref() {
                if let Ok(info) = fetch_oidc_userinfo(issuer, token).await {
                    if info.sub == claims.sub {
                        email = usable_oidc_email(info.email);
                    }
                }
            }
        }
    }

    let email = email.ok_or(DomainError::Validation(
        "OIDC login requires an email from your identity provider — enable the email scope in Auth0"
            .into(),
    ))?;

    Ok(ExternalUser {
        subject: claims.sub,
        email,
        display_name: claims.name,
        username_hint: claims.preferred_username,
    })
}
