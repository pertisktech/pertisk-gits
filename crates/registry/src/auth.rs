use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use pertisk_git::access::{self, AuthUser};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

use crate::access::{can_pull, can_push, parse_image_name};

pub const REGISTRY_TOKEN_TTL_SECS: i64 = 300;
pub const CI_REGISTRY_BASIC_USER: &str = "gitlab-ci-token";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CiRegistryBasicClaims {
    pub sub: String,
    pub job_id: String,
    pub repository: String,
    pub exp: i64,
    pub iat: i64,
}

#[derive(Debug, Clone)]
pub struct CiRegistryBasicAuth {
    pub job_id: Uuid,
    pub repository: String,
}

#[derive(Debug, Clone)]
pub enum BasicPrincipal {
    User(AuthUser),
    Ci(CiRegistryBasicAuth),
}

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
    // Some Docker clients/intermediaries fail to complete Bearer token exchange.
    // Offer Basic as a fallback so clients can resend stored login credentials.
    headers.append(
        header::WWW_AUTHENTICATE,
        HeaderValue::from_static("Basic realm=\"Registry\""),
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

pub fn issue_ci_registry_basic_token(
    jwt_secret: &str,
    job_id: Uuid,
    repository: &str,
    ttl_secs: i64,
) -> anyhow::Result<String> {
    let now = chrono::Utc::now().timestamp();
    let ttl_secs = ttl_secs.max(60);
    let claims = CiRegistryBasicClaims {
        sub: "ci-registry-basic".into(),
        job_id: job_id.to_string(),
        repository: repository.to_string(),
        iat: now,
        exp: now + ttl_secs,
    };
    Ok(encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(jwt_secret.as_bytes()),
    )?)
}

pub fn verify_ci_registry_basic_token(
    jwt_secret: &str,
    token: &str,
) -> anyhow::Result<CiRegistryBasicAuth> {
    let data = decode::<CiRegistryBasicClaims>(
        token,
        &DecodingKey::from_secret(jwt_secret.as_bytes()),
        &Validation::default(),
    )?;
    if data.claims.sub != "ci-registry-basic" {
        anyhow::bail!("invalid ci registry token subject");
    }
    let job_id = Uuid::parse_str(&data.claims.job_id)?;
    Ok(CiRegistryBasicAuth {
        job_id,
        repository: data.claims.repository,
    })
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
    let is_super_admin = crate::access::is_super_admin_user(pool, user.id).await?;
    let mut granted = Vec::new();
    for (name, actions) in scopes {
        if name == "catalog" {
            if is_super_admin {
                granted.push(RegistryAccess {
                    access_type: "registry".into(),
                    name: "catalog".into(),
                    actions: if actions.is_empty() {
                        vec!["*".into()]
                    } else {
                        actions.clone()
                    },
                });
                continue;
            }

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

        let Some(parsed) = parse_image_name(name) else {
            continue;
        };

        if is_super_admin {
            granted.push(RegistryAccess {
                access_type: "repository".into(),
                name: name.clone(),
                actions: if actions.is_empty() {
                    vec!["pull".into(), "push".into()]
                } else {
                    actions.clone()
                },
            });
            continue;
        }

        let mut allowed_actions = Vec::new();
        for action in actions {
            let ok = match action.as_str() {
                "pull" => can_pull(pool, &parsed.org_path, &parsed.project_slug, user.id).await?,
                "push" => can_push(pool, &parsed.org_path, &parsed.project_slug, user.id).await?,
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
        match verify_registry_token(jwt_secret, &token) {
            Ok(auth) => {
                if let (Some(repo), Some(act)) = (repo_name, action) {
                    if auth_allows(&auth, repo, act) {
                        return Ok(auth);
                    }
                    tracing::warn!(
                        user_id = %auth.user_id,
                        repo = repo,
                        action = act,
                        granted = ?auth.access,
                        "registry bearer token missing required scope"
                    );
                    return Err(registry_err(
                        StatusCode::FORBIDDEN,
                        "insufficient scope",
                    ));
                }
                return Ok(auth);
            }
            Err(error) => {
                tracing::warn!(
                    repo = ?repo_name,
                    action = ?action,
                    error = %error,
                    "registry bearer token verification failed"
                );
            }
        }
    }

    if let Ok(Some(principal)) = authenticate_basic_principal(pool, jwt_secret, headers).await {
        match principal {
            BasicPrincipal::User(user) => {
                if let (Some(repo), Some(act)) = (repo_name, action) {
                    return authorize_basic_repo(pool, user, repo, act).await;
                }
                return Ok(RegistryAuth {
                    user_id: user.id,
                    access: vec![],
                });
            }
            BasicPrincipal::Ci(ci) => {
                if let (Some(repo), Some(act)) = (repo_name, action) {
                    if repo == ci.repository && (act == "pull" || act == "push") {
                        return Ok(RegistryAuth {
                            user_id: Uuid::nil(),
                            access: vec![RegistryAccess {
                                access_type: "repository".into(),
                                name: ci.repository,
                                actions: vec![act.to_string()],
                            }],
                        });
                    }
                    return Err(registry_err(StatusCode::FORBIDDEN, "insufficient scope"));
                }
                return Ok(RegistryAuth {
                    user_id: Uuid::nil(),
                    access: vec![],
                });
            }
        }
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

    tracing::warn!(
        repo,
        action = act,
        has_bearer = parse_bearer(headers).is_some(),
        has_auth_header = headers.get(header::AUTHORIZATION).is_some(),
        "registry authorization failed; returning challenge"
    );

    Err(registry_unauthorized(token_url, service_name, repo, act))
}

async fn authorize_basic_repo(
    pool: &PgPool,
    user: AuthUser,
    repo_name: &str,
    action: &str,
) -> Result<RegistryAuth, (StatusCode, HeaderMap, String)> {
    if crate::access::is_super_admin_user(pool, user.id)
        .await
        .map_err(|e| registry_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?
    {
        return Ok(RegistryAuth {
            user_id: user.id,
            access: vec![RegistryAccess {
                access_type: "repository".into(),
                name: repo_name.to_string(),
                actions: vec![action.to_string()],
            }],
        });
    }

    let Some(parsed) = crate::access::parse_image_name(repo_name) else {
        return Err(registry_err(
            StatusCode::BAD_REQUEST,
            "invalid repository name",
        ));
    };

    let allowed = match action {
        "pull" => crate::access::can_pull(pool, &parsed.org_path, &parsed.project_slug, user.id)
            .await
            .map_err(|e| registry_err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?,
        "push" => crate::access::can_push(pool, &parsed.org_path, &parsed.project_slug, user.id)
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

pub async fn authenticate_basic_principal(
    pool: &PgPool,
    jwt_secret: &str,
    headers: &HeaderMap,
) -> anyhow::Result<Option<BasicPrincipal>> {
    let header = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok());
    let Some(header) = header else {
        return Ok(None);
    };
    let Some((user, pass)) = access::parse_basic_auth(header) else {
        return Ok(None);
    };

    if user == CI_REGISTRY_BASIC_USER {
        if let Ok(ci) = verify_ci_registry_basic_token(jwt_secret, &pass) {
            return Ok(Some(BasicPrincipal::Ci(ci)));
        }
    }

    Ok(access::authenticate_basic(pool, &user, &pass)
        .await?
        .map(BasicPrincipal::User))
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
    // Docker push performs both pull (blob existence checks) and push operations.
    // Advertise both actions up-front so clients can fetch a single usable token.
    let requested_actions = if action == "push" { "pull,push" } else { action };
    let scope = format!("repository:{repo_name}:{requested_actions}");
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

    #[test]
    fn registry_token_round_trip() {
        let user_id = Uuid::new_v4();
        let secret = "registry-jwt-secret";
        let access = vec![RegistryAccess {
            access_type: "repository".into(),
            name: "acme/widget".into(),
            actions: vec!["pull".into()],
        }];
        let token = issue_registry_token(secret, user_id, access.clone()).unwrap();
        let auth = verify_registry_token(secret, &token).unwrap();
        assert_eq!(auth.user_id, user_id);
        assert_eq!(auth.access.len(), 1);
        assert!(auth_allows(&auth, "acme/widget", "pull"));
        assert!(!auth_allows(&auth, "acme/widget", "push"));
    }

    #[test]
    fn parse_bearer_header() {
        let mut headers = HeaderMap::new();
        headers.insert(
            header::AUTHORIZATION,
            HeaderValue::from_static("Bearer my-token"),
        );
        assert_eq!(parse_bearer(&headers).as_deref(), Some("my-token"));
        assert!(parse_bearer(&HeaderMap::new()).is_none());
    }

    #[test]
    fn catalog_access_granted() {
        let auth = RegistryAuth {
            user_id: Uuid::new_v4(),
            access: vec![RegistryAccess {
                access_type: "registry".into(),
                name: "catalog".into(),
                actions: vec!["*".into()],
            }],
        };
        assert!(auth_allows_catalog(&auth));
    }

    #[test]
    fn unauthorized_headers_format() {
        let headers = unauthorized_headers("https://registry/token", "pertisk", "repository:org/img:pull");
        let value = headers.get(header::WWW_AUTHENTICATE).unwrap().to_str().unwrap();
        assert!(value.contains("realm=\"https://registry/token\""));
        assert!(value.contains("service=\"pertisk\""));
    }

    #[test]
    fn merge_scopes_dedupes_actions() {
        let merged = merge_scopes(vec![
            ("repo".into(), vec!["pull".into()]),
            ("repo".into(), vec!["push".into()]),
        ]);
        assert_eq!(merged.len(), 1);
        assert!(merged[0].1.contains(&"pull".to_string()));
        assert!(merged[0].1.contains(&"push".to_string()));
    }

    #[test]
    fn ci_registry_basic_token_round_trip() {
        let secret = "registry-jwt-secret";
        let job_id = Uuid::new_v4();
        let repo = "acme/widget";
        let token = issue_ci_registry_basic_token(secret, job_id, repo, 3600).unwrap();
        let auth = verify_ci_registry_basic_token(secret, &token).unwrap();
        assert_eq!(auth.job_id, job_id);
        assert_eq!(auth.repository, repo);
    }
}
