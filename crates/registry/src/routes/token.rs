use axum::{
    extract::{RawQuery, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use chrono::Utc;

use crate::auth::{
    authenticate_basic, authorize_scopes, issue_registry_token, parse_scope_params,
    unauthorized_headers, TokenResponse,
};
use crate::routes::v2::RegistryState;

pub struct TokenRequest {
    pub service: Option<String>,
    pub scope: Vec<String>,
}

pub fn parse_token_query(raw: Option<&str>) -> TokenRequest {
    let mut service = None;
    let mut scope = Vec::new();

    let Some(query) = raw else {
        return TokenRequest { service, scope };
    };

    for (key, value) in url::form_urlencoded::parse(query.as_bytes()) {
        match key.as_ref() {
            "service" => service = Some(value.into_owned()),
            "scope" => scope.push(value.into_owned()),
            _ => {}
        }
    }

    TokenRequest { service, scope }
}

pub async fn get_token(
    State(state): State<RegistryState>,
    RawQuery(raw_query): RawQuery,
    headers: HeaderMap,
) -> Result<Json<TokenResponse>, (StatusCode, HeaderMap)> {
    let query = parse_token_query(raw_query.as_deref());
    let service = query.service.as_deref().unwrap_or(&state.service_name);
    let scope_display = query.scope.join(",");
    let www = unauthorized_headers(&state.token_url, service, &scope_display);

    let user = authenticate_basic(&state.pool, &headers)
        .await
        .map_err(|_| (StatusCode::UNAUTHORIZED, www.clone()))?
        .ok_or((StatusCode::UNAUTHORIZED, www))?;

    tracing::info!(
        user_id = %user.id,
        service,
        scopes = ?query.scope,
        "registry token request"
    );

    let scopes = parse_scope_params(&query.scope);
    let access = if scopes.is_empty() {
        // Docker login probe — credentials validated above; scoped token fetched on pull/push.
        vec![]
    } else {
        authorize_scopes(&state.pool, &user, &scopes)
            .await
            .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, HeaderMap::new()))?
    };

    if !scopes.is_empty() && access.is_empty() {
        tracing::warn!(
            user_id = %user.id,
            requested = ?query.scope,
            "registry token denied: no scopes granted"
        );
        return Err((StatusCode::FORBIDDEN, HeaderMap::new()));
    }

    tracing::info!(
        user_id = %user.id,
        granted = ?access,
        "registry token granted"
    );

    let token = issue_registry_token(&state.jwt_secret, user.id, access)
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, HeaderMap::new()))?;

    Ok(Json(TokenResponse {
        token,
        expires_in: crate::auth::REGISTRY_TOKEN_TTL_SECS,
        issued_at: Some(Utc::now().to_rfc3339()),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_query_accepts_duplicate_scope_keys() {
        let q = "service=pertisk-registry&scope=repository%3Anode-js%2Fnode-express%3Apull&scope=repository%3Anode-js%2Fnode-express%3Apull%2Cpush";
        let parsed = parse_token_query(Some(q));
        assert_eq!(parsed.scope.len(), 2);
        assert_eq!(parsed.service.as_deref(), Some("pertisk-registry"));
    }

    #[test]
    fn token_query_accepts_single_scope_key() {
        let q = "scope=repository%3Aorg%2Fimage%3Apull%2Cpush";
        let parsed = parse_token_query(Some(q));
        assert_eq!(parsed.scope, vec!["repository:org/image:pull,push"]);
    }
}
