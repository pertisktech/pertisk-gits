use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use pertisk_git::access::{self, AuthUser};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

use crate::access::{can_pull, can_push, parse_image_name};

pub const REGISTRY_TOKEN_TTL_SECS: i64 = 300;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegistryAccess {
    #[serde(rename = "type")]
    pub access_type: String,
    pub name: String,
    pub actions: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RegistryTokenClaims {
    pub sub: String,
    pub access: Vec<RegistryAccess>,
    pub exp: i64,
    pub iat: i64,
}

#[derive(Debug, Clone)]
pub struct RegistryAuth {
    pub user_id: Uuid,
    pub access: Vec<RegistryAccess>,
}

#[derive(Serialize)]
pub struct TokenResponse {
    pub token: String,
    #[serde(rename = "expires_in")]
    pub expires_in: i64,
    #[serde(rename = "issued_at")]
    pub issued_at: Option<String>,
}

pub fn unauthorized_headers(token_url: &str, service: &str, scope: &str) -> HeaderMap {
    let mut headers = HeaderMap::new();
    let value = format!(
        r#"Bearer realm="{token_url}",service="{service}",scope="{scope}""#
    );
    headers.insert(
        header::WWW_AUTHENTICATE,
        HeaderValue::from_str(&value).unwrap_or_else(|_| HeaderValue::from_static("Bearer")),
    );
    headers
}

pub fn parse_bearer(headers: &HeaderMap) -> Option<String> {
    headers
        .get(header::AUTHORIZATION)?
        .to_str()
        .ok()?
        .strip_prefix("Bearer ")
        .map(str::to_string)
}

pub fn issue_registry_token(
    jwt_secret: &str,
    user_id: Uuid,
    access: Vec<RegistryAccess>,
) -> anyhow::Result<String> {
    let now = chrono::Utc::now().timestamp();
    let claims = RegistryTokenClaims {
        sub: user_id.to_string(),
        access,
        iat: now,
        exp: now + REGISTRY_TOKEN_TTL_SECS,
    };
    Ok(encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(jwt_secret.as_bytes()),
    )?)
}

pub fn verify_registry_token(jwt_secret: &str, token: &str) -> anyhow::Result<RegistryAuth> {
    let data = decode::<RegistryTokenClaims>(
        token,
        &DecodingKey::from_secret(jwt_secret.as_bytes()),
        &Validation::default(),
    )?;
    let user_id = Uuid::parse_str(&data.claims.sub)?;
    Ok(RegistryAuth {
        user_id,
        access: data.claims.access,
    })
}

pub fn parse_scopes(scope: &str) -> Vec<(String, Vec<String>)> {
    split_scope_entries(scope)
        .iter()
        .filter_map(|part| parse_single_scope(part))
        .collect()
}

fn split_scope_entries(scope: &str) -> Vec<String> {
    let scope = scope.trim();
    if scope.is_empty() {
        return Vec::new();
    }

    let mut entries = Vec::new();
    let mut start = 0usize;
    for (idx, _) in scope.match_indices(",repository:") {
        entries.push(scope[start..idx].trim().to_string());
        start = idx + 1;
    }
    entries.push(scope[start..].trim().to_string());
    entries
}

fn parse_single_scope(part: &str) -> Option<(String, Vec<String>)> {
    let part = part.trim();
    if let Some(actions) = part.strip_prefix("registry:catalog:") {
        let actions: Vec<String> = actions.split(',').map(str::trim).map(String::from).collect();
        return Some(("catalog".to_string(), actions));
    }
    let rest = part.strip_prefix("repository:")?;
    let (name, actions) = rest.rsplit_once(':')?;
    let actions: Vec<String> = actions.split(',').map(str::trim).map(String::from).collect();
    Some((name.to_string(), actions))
}

/// Docker may send duplicate `scope` query params; merge actions per repository name.
pub fn merge_scopes(scopes: Vec<(String, Vec<String>)>) -> Vec<(String, Vec<String>)> {
    use std::collections::{HashMap, HashSet};

    let mut merged: HashMap<String, HashSet<String>> = HashMap::new();
    for (name, actions) in scopes {
        merged.entry(name).or_default().extend(actions);
    }
    merged
        .into_iter()
        .map(|(name, actions)| (name, actions.into_iter().collect()))
        .collect()
}

pub fn parse_scope_params(params: &[String]) -> Vec<(String, Vec<String>)> {
    merge_scopes(
        params
            .iter()
            .flat_map(|scope| parse_scopes(scope))
            .collect(),
    )
}

pub async fn authorize_scopes(
    pool: &PgPool,
    user: &AuthUser,
    scopes: &[(String, Vec<String>)],
) -> anyhow::Result<Vec<RegistryAccess>> {
    let mut granted = Vec::new();
    for (name, actions) in scopes {
        if name == "catalog" {
            if user_has_catalog_access(pool, user.id).await? {
                granted.push(RegistryAccess {
                    access_type: "registry".into(),
                    name: "catalog".into(),
                    actions: if actions.is_empty() {
                        vec!["*".into()]
                    } else {
                        actions.clone()
                    },
                });
            }
            continue;
        }

        let Some((org, _image)) = parse_image_name(name) else {
            continue;
        };
        let mut allowed_actions = Vec::new();
        for action in actions {
            let ok = match action.as_str() {
                "pull" => can_pull(pool, org, user.id).await?,
                "push" => can_push(pool, org, user.id).await?,
                _ => false,
            };
            if ok {
                allowed_actions.push(action.clone());
            }
        }
        if !allowed_actions.is_empty() {
            granted.push(RegistryAccess {
                access_type: "repository".into(),
                name: name.clone(),
                actions: allowed_actions,
            });
        }
    }
    Ok(granted)
}

pub fn auth_allows(auth: &RegistryAuth, repo_name: &str, action: &str) -> bool {
    auth.access.iter().any(|entry| {
        entry.access_type == "repository"
            && entry.name == repo_name
            && entry.actions.iter().any(|a| a == action)
    })
}

pub fn auth_allows_catalog(auth: &RegistryAuth) -> bool {
    auth.access.iter().any(|entry| {
        entry.access_type == "registry" && entry.name == "catalog"
    })
}

async fn user_has_catalog_access(pool: &PgPool, user_id: Uuid) -> anyhow::Result<bool> {
    crate::access::user_has_org_membership(pool, user_id).await
}

/// Authenticate a registry request via Bearer token or HTTP Basic (docker login).
pub async fn authorize_registry(
    pool: &PgPool,
    jwt_secret: &str,
    token_url: &str,
    service_name: &str,
    headers: &HeaderMap,
    repo_name: Option<&str>,
    action: Option<&str>,
    allow_anonymous_pull: bool,
) -> Result<RegistryAuth, (StatusCode, HeaderMap, String)> {
    if let Some(token) = parse_bearer(headers) {
        if let Ok(auth) = verify_registry_token(jwt_secret, &token) {
            if let (Some(repo), Some(act)) = (repo_name, action) {
                if auth_allows(&auth, repo, act) {
                    return Ok(auth);
                }
                return Err(registry_err(
                    StatusCode::FORBIDDEN,
                    "insufficient scope",
                ));
            }
            return Ok(auth);
        }
    }

    if let Ok(Some(user)) = authenticate_basic(pool, headers).await {
        if let (Some(repo), Some(act)) = (repo_name, action) {
            return authorize_basic_repo(pool, user, repo, act).await;
        }
        return Ok(RegistryAuth {
            user_id: user.id,
            access: vec![],
        });
    }

    let (repo, act) = match (repo_name, action) {
        (Some(repo), Some(act)) => (repo, act),
        _ => {
            return Err((
                StatusCode::UNAUTHORIZED,
                unauthorized_headers(token_url, service_name, ""),
                "Unauthorized".into(),
            ));
        }
    };

    if allow_anonymous_pull && act == "pull" {
        let public = crate::access::is_public_container_image(pool, repo)
            .await
            .unwrap_or(false);
        if public {
            return Ok(RegistryAuth {
                user_id: Uuid::nil(),
                access: vec![RegistryAccess {
                    access_type: "repository".into(),
                    name: repo.to_string(),
                    actions: vec!["pull".into()],
                }],
            });
        }
    }

    Err(registry_unauthorized(token_url, service_name, repo, act))
}

async fn authorize_basic_repo(
    pool: &PgPool,
    user: AuthUser,
    repo_name: &str,
    action: &str,
) -> Result<RegistryAuth, (StatusCode, HeaderMap, String)> {
    let Some((org, _image)) = crate::access::parse_image_name(repo_name) else {
        return Err(registry_err(
            StatusCode::BAD_REQUEST,
            "invalid repository name",
        ));
    };

    let allowed = match action {
        "pull" => crate::access::can_pull(pool, org, user.id)
            .await
            .map_err(|e| registry_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?,
        "push" => crate::access::can_push(pool, org, user.id)
            .await
            .map_err(|e| registry_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?,
        _ => false,
    };

    if !allowed {
        return Err(registry_err(
            StatusCode::FORBIDDEN,
            "insufficient scope",
        ));
    }

    Ok(RegistryAuth {
        user_id: user.id,
        access: vec![RegistryAccess {
            access_type: "repository".into(),
            name: repo_name.to_string(),
            actions: vec![action.to_string()],
        }],
    })
}

pub async fn authenticate_basic(
    pool: &PgPool,
    headers: &HeaderMap,
) -> anyhow::Result<Option<AuthUser>> {
    let header = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok());
    let Some(header) = header else {
        return Ok(None);
    };
    let Some((user, pass)) = access::parse_basic_auth(header) else {
        return Ok(None);
    };
    access::authenticate_basic(pool, &user, &pass).await
}

pub type RegistryResult<T> = Result<T, (StatusCode, HeaderMap, String)>;

pub fn registry_err(status: StatusCode, message: &str) -> (StatusCode, HeaderMap, String) {
    (status, HeaderMap::new(), message.into())
}

pub fn registry_unauthorized(
    token_url: &str,
    service_name: &str,
    repo_name: &str,
    action: &str,
) -> (StatusCode, HeaderMap, String) {
    let scope = format!("repository:{repo_name}:{action}");
    (
        StatusCode::UNAUTHORIZED,
        unauthorized_headers(token_url, service_name, &scope),
        "Unauthorized".into(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_catalog_scope() {
        let scopes = parse_scopes("registry:catalog:*");
        assert_eq!(scopes.len(), 1);
        assert_eq!(scopes[0].0, "catalog");
        assert_eq!(scopes[0].1, vec!["*"]);
    }

    #[test]
    fn split_combined_scope_string() {
        let scopes = parse_scopes("repository:node-js/node-express:pull,push");
        assert_eq!(scopes.len(), 1);
        assert_eq!(scopes[0].0, "node-js/node-express");
        assert_eq!(scopes[0].1, vec!["pull", "push"]);
    }

    #[test]
    fn parse_duplicate_docker_scope_params() {
        let params = vec![
            "repository:node-js/node-express:pull".into(),
            "repository:node-js/node-express:pull,push".into(),
        ];
        let merged = parse_scope_params(&params);
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].0, "node-js/node-express");
        assert!(merged[0].1.contains(&"pull".to_string()));
        assert!(merged[0].1.contains(&"push".to_string()));
    }
}
