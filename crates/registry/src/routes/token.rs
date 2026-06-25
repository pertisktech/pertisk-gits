use axum::{
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use chrono::Utc;
use serde::Deserialize;

use crate::auth::{
    authenticate_basic, authorize_scopes, issue_registry_token, parse_scopes,
    unauthorized_headers, TokenResponse,
};
use crate::routes::v2::RegistryState;

#[derive(Deserialize)]
#[allow(dead_code)]
pub struct TokenQuery {
    service: Option<String>,
    scope: Option<String>,
    account: Option<String>, // reserved for Docker account param
}

pub async fn get_token(
    State(state): State<RegistryState>,
    Query(query): Query<TokenQuery>,
    headers: HeaderMap,
) -> Result<Json<TokenResponse>, (StatusCode, HeaderMap)> {
    let service = query.service.as_deref().unwrap_or(&state.service_name);
    let scope = query.scope.as_deref().unwrap_or("");
    let www = unauthorized_headers(&state.token_url, service, scope);

    let user = authenticate_basic(&state.pool, &headers)
        .await
        .map_err(|_| (StatusCode::UNAUTHORIZED, www.clone()))?
        .ok_or((StatusCode::UNAUTHORIZED, www))?;

    let scopes = parse_scopes(scope);
    let access = authorize_scopes(&state.pool, &user, &scopes)
        .await
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, HeaderMap::new()))?;

    if access.is_empty() {
        return Err((StatusCode::FORBIDDEN, HeaderMap::new()));
    }

    let token = issue_registry_token(&state.jwt_secret, user.id, access)
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, HeaderMap::new()))?;

    Ok(Json(TokenResponse {
        token,
        expires_in: crate::auth::REGISTRY_TOKEN_TTL_SECS,
        issued_at: Some(Utc::now().to_rfc3339()),
    }))
}
