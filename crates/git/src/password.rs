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
