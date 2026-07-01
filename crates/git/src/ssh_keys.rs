use anyhow::Context;
use russh::keys::ssh_key::{HashAlg, PublicKey};
use sqlx::PgPool;
use uuid::Uuid;

use crate::access::AuthUser;

#[derive(Debug, Clone)]
pub struct ParsedSshKey {
    pub public_key: String,
    pub fingerprint: String,
}

pub fn parse_public_key(input: &str) -> anyhow::Result<ParsedSshKey> {
    let key = PublicKey::from_openssh(input.trim()).context("invalid SSH public key")?;
    let fingerprint = fingerprint_of_key(&key);
    let public_key = key.to_openssh().context("encode public key")?;

    Ok(ParsedSshKey {
        public_key,
        fingerprint,
    })
}

pub fn fingerprint_of_key(key: &PublicKey) -> String {
    key.fingerprint(HashAlg::Sha256).to_string()
}

pub async fn find_user_by_fingerprint(
    pool: &PgPool,
    fingerprint: &str,
) -> anyhow::Result<Option<AuthUser>> {
    let row = sqlx::query_as::<_, (Uuid, String)>(
        r#"
        SELECT u.id, u.username
        FROM user_ssh_keys k
        INNER JOIN users u ON u.id = k.user_id
        WHERE k.fingerprint = $1
        "#,
    )
    .bind(fingerprint)
    .fetch_optional(pool)
    .await?;

    Ok(row.map(|(id, username)| AuthUser { id, username }))
}

pub async fn deploy_key_fingerprint_exists(
    pool: &PgPool,
    fingerprint: &str,
) -> anyhow::Result<bool> {
    let exists = sqlx::query_scalar::<_, bool>(
        r#"
        SELECT EXISTS(
            SELECT 1 FROM repository_deploy_keys WHERE fingerprint = $1
        )
        "#,
    )
    .bind(fingerprint)
    .fetch_one(pool)
    .await?;

    Ok(exists)
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEST_ED25519: &str = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJQWX8KFzA1MEVN0MBf95pgmMz5a2wfhHLAnPJwRhrUD test@example.com";

    #[test]
    fn parse_public_key_accepts_openssh_format() {
        let parsed = parse_public_key(TEST_ED25519).unwrap();
        assert!(parsed.public_key.starts_with("ssh-ed25519 "));
        assert!(!parsed.fingerprint.is_empty());
    }

    #[test]
    fn parse_public_key_rejects_garbage() {
        assert!(parse_public_key("not a key").is_err());
    }

    #[test]
    fn fingerprint_of_key_is_stable() {
        let first = parse_public_key(TEST_ED25519).unwrap();
        let key = PublicKey::from_openssh(TEST_ED25519).unwrap();
        assert_eq!(fingerprint_of_key(&key), first.fingerprint);
    }
}
