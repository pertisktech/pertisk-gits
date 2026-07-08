use axum::{
    extract::{RawQuery, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use chrono::Utc;

use crate::auth::{
    authenticate_basic_principal, authorize_scopes, issue_registry_token, parse_scope_params,
    unauthorized_headers, BasicPrincipal, RegistryAccess, TokenResponse,
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

    let principal = authenticate_basic_principal(&state.pool, &state.jwt_secret, &headers)
        .await
        .map_err(|_| (StatusCode::UNAUTHORIZED, www.clone()))?
        .ok_or((StatusCode::UNAUTHORIZED, www))?;

    let actor = match &principal {
        BasicPrincipal::User(user) => user.id.to_string(),
        BasicPrincipal::Ci(ci) => format!("ci:{}", ci.job_id),
    };

    tracing::info!(actor = %actor, service, scopes = ?query.scope, "registry token request");

    let scopes = parse_scope_params(&query.scope);
    let access = if scopes.is_empty() {
        // Docker login probe — credentials validated above; scoped token fetched on pull/push.
        vec![]
    } else {
        match &principal {
            BasicPrincipal::User(user) => authorize_scopes(&state.pool, user, &scopes)
                .await
                .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, HeaderMap::new()))?,
            BasicPrincipal::Ci(ci) => ci_granted_scopes(ci.repository.as_str(), &scopes),
        }
    };

    if !scopes.is_empty() && access.is_empty() {
        tracing::warn!(
            actor = %actor,
            requested = ?query.scope,
            "registry token denied: no scopes granted"
        );
        return Err((StatusCode::FORBIDDEN, HeaderMap::new()));
    }

    tracing::info!(
        actor = %actor,
        granted = ?access,
        "registry token granted"
    );

    let subject = match &principal {
        BasicPrincipal::User(user) => user.id,
        BasicPrincipal::Ci(_) => uuid::Uuid::nil(),
    };

    let token = issue_registry_token(&state.jwt_secret, subject, access)
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, HeaderMap::new()))?;

    Ok(Json(TokenResponse {
        token,
        expires_in: crate::auth::REGISTRY_TOKEN_TTL_SECS,
        issued_at: Some(Utc::now().to_rfc3339()),
    }))
}

fn ci_granted_scopes(
    allowed_repository: &str,
    scopes: &[(String, Vec<String>)],
) -> Vec<RegistryAccess> {
    let mut granted = Vec::new();
    for (name, actions) in scopes {
        if name != allowed_repository {
            continue;
        }
        let actions: Vec<String> = actions
            .iter()
            .filter(|action| action.as_str() == "pull" || action.as_str() == "push")
            .cloned()
            .collect();
        if actions.is_empty() {
            continue;
        }
        granted.push(RegistryAccess {
            access_type: "repository".into(),
            name: name.clone(),
            actions,
        });
    }
    granted
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
