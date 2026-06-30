use axum::{
    extract::{Query, State},
    response::Redirect,
};
use base64::Engine;
use pertisk_domain::models::{AuditEventType, AuthProviderType};
use pertisk_domain::DomainError;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use super::{
    api_callback_url, ensure_enabled_provider, frontend_callback_url, issue_auth_response,
    jit_provision_user, load_provider, random_token, store_flow_state, take_flow_state,
    ExternalUser,
};
use crate::{
    audit::{record_audit_event, AuditEventInput},
    ApiError, AppState,
};

#[derive(Deserialize)]
pub struct OidcCallbackQuery {
    code: String,
    state: String,
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

#[derive(Deserialize)]
struct OidcIdClaims {
    sub: String,
    email: Option<String>,
    preferred_username: Option<String>,
    name: Option<String>,
}

pub async fn start_oidc_login(
    state: &AppState,
    provider_id: Uuid,
) -> Result<Redirect, ApiError> {
    let provider = load_provider(&state.pool, provider_id).await?;
    ensure_enabled_provider(&provider)?;
    if provider.provider_type != AuthProviderType::Oidc {
        return Err(DomainError::Validation("provider is not OIDC".into()).into());
    }

    let discovery = fetch_discovery(provider.issuer_url.as_deref().ok_or(
        DomainError::Validation("missing issuer_url".into()),
    )?)
    .await?;

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
    let scopes = urlencoding::encode(provider.scopes.as_str());

    let auth_url = format!(
        "{}?response_type=code&client_id={}&redirect_uri={}&scope={}&state={}&code_challenge={}&code_challenge_method=S256",
        discovery.authorization_endpoint,
        urlencoding::encode(client_id),
        urlencoding::encode(&redirect_uri),
        scopes,
        urlencoding::encode(&flow_state),
        urlencoding::encode(&challenge),
    );

    Ok(Redirect::temporary(&auth_url))
}

pub async fn oidc_callback(
    State(state): State<AppState>,
    Query(query): Query<OidcCallbackQuery>,
) -> Result<Redirect, ApiError> {
    let flow = take_flow_state(&state.pool, &query.state).await?;
    let provider = load_provider(&state.pool, flow.provider_id).await?;
    ensure_enabled_provider(&provider)?;

    let discovery = fetch_discovery(provider.issuer_url.as_deref().ok_or(
        DomainError::Validation("missing issuer_url".into()),
    )?)
    .await?;

    let client_id = provider
        .client_id
        .as_deref()
        .ok_or(DomainError::Validation("missing client_id".into()))?;
    let redirect_uri = api_callback_url(&state, "/auth/oidc/callback");
    let verifier = flow
        .code_verifier
        .ok_or(DomainError::Validation("missing PKCE verifier".into()))?;

    let body = if provider.client_secret.as_ref().is_some_and(|s| !s.is_empty()) {
        format!(
            "grant_type=authorization_code&code={}&redirect_uri={}&code_verifier={}",
            urlencoding::encode(&query.code),
            urlencoding::encode(&redirect_uri),
            urlencoding::encode(&verifier),
        )
    } else {
        format!(
            "grant_type=authorization_code&code={}&redirect_uri={}&client_id={}&code_verifier={}",
            urlencoding::encode(&query.code),
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

    let email = claims
        .email
        .or(claims.preferred_username.as_ref().map(|u| format!("{u}@sso.local")))
        .ok_or(DomainError::Validation("OIDC token missing email".into()))?;

    let external = ExternalUser {
        subject: claims.sub,
        email: email.clone(),
        display_name: claims.name,
        username_hint: claims.preferred_username,
    };

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
            metadata: Some(serde_json::json!({ "provider_type": "oidc", "email": email })),
            ip_address: None,
            user_agent: None,
        },
    )
    .await?;

    let auth = issue_auth_response(&state, user, "oidc").await?;
    Ok(Redirect::temporary(&frontend_callback_url(
        &state,
        &auth.token,
    )))
}

async fn fetch_discovery(issuer_url: &str) -> Result<OidcDiscovery, ApiError> {
    let issuer = issuer_url.trim_end_matches('/');
    let url = format!("{issuer}/.well-known/openid-configuration");
    let http = reqwest::Client::new();
    http.get(url)
        .send()
        .await
        .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?
        .error_for_status()
        .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?
        .json::<OidcDiscovery>()
        .await
        .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))
}

fn pkce_challenge(verifier: &str) -> String {
    let digest = Sha256::digest(verifier.as_bytes());
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(digest)
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
