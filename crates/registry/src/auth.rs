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
    scope
        .split(',')
        .filter_map(|part| {
            let part = part.trim();
            let rest = part.strip_prefix("repository:")?;
            let (name, actions) = rest.rsplit_once(':')?;
            let actions: Vec<String> = actions.split(',').map(str::trim).map(String::from).collect();
            Some((name.to_string(), actions))
        })
        .collect()
}

pub async fn authorize_scopes(
    pool: &PgPool,
    user: &AuthUser,
    scopes: &[(String, Vec<String>)],
) -> anyhow::Result<Vec<RegistryAccess>> {
    let mut granted = Vec::new();
    for (name, actions) in scopes {
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
