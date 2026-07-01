use chrono::{Duration, Utc};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: Uuid,
    pub username: String,
    pub exp: i64,
    pub iat: i64,
}

pub fn create_token(
    user_id: Uuid,
    username: &str,
    secret: &str,
    ttl_hours: i64,
) -> Result<String, jsonwebtoken::errors::Error> {
    let now = Utc::now();
    let claims = Claims {
        sub: user_id,
        username: username.to_string(),
        iat: now.timestamp(),
        exp: (now + Duration::hours(ttl_hours)).timestamp(),
    };

    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
}

pub fn verify_token(secret: &str, token: &str) -> Result<Claims, jsonwebtoken::errors::Error> {
    let data = decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &Validation::default(),
    )?;
    Ok(data.claims)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_round_trip() {
        let user_id = Uuid::new_v4();
        let secret = "test-secret-key";
        let token = create_token(user_id, "alice", secret, 24).unwrap();
        let claims = verify_token(secret, &token).unwrap();
        assert_eq!(claims.sub, user_id);
        assert_eq!(claims.username, "alice");
        assert!(claims.exp > claims.iat);
    }

    #[test]
    fn wrong_secret_rejected() {
        let user_id = Uuid::new_v4();
        let token = create_token(user_id, "alice", "secret-a", 1).unwrap();
        assert!(verify_token("secret-b", &token).is_err());
    }

    #[test]
    fn malformed_token_rejected() {
        assert!(verify_token("secret", "not-a-jwt").is_err());
    }
}
