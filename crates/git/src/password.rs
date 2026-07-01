use argon2::{
    password_hash::{PasswordHash, PasswordVerifier},
    Argon2,
};

pub fn verify_password(password: &str, password_hash: &str) -> anyhow::Result<bool> {
    let parsed = PasswordHash::new(password_hash).map_err(|e| anyhow::anyhow!("parse hash: {e}"))?;
    Ok(Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok())
}

#[cfg(test)]
mod tests {
    use super::*;
    use argon2::password_hash::{PasswordHasher, SaltString};
    use argon2::Argon2;

    #[test]
    fn verify_password_accepts_valid_hash() {
        let salt = SaltString::generate(&mut argon2::password_hash::rand_core::OsRng);
        let hash = Argon2::default()
            .hash_password(b"s3cret-pass", &salt)
            .unwrap()
            .to_string();
        assert!(verify_password("s3cret-pass", &hash).unwrap());
        assert!(!verify_password("wrong", &hash).unwrap());
    }
}
