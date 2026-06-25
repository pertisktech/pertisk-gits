use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    Aes256Gcm, Nonce,
};
use sha2::{Digest, Sha256};

const NONCE_LEN: usize = 12;

pub struct SecretsCrypto {
    cipher: Aes256Gcm,
}

impl SecretsCrypto {
    pub fn from_env() -> anyhow::Result<Self> {
        let key = if let Ok(raw) = std::env::var("SECRETS_ENCRYPTION_KEY") {
            decode_key(&raw)?
        } else if let Ok(jwt) = std::env::var("JWT_SECRET") {
            tracing::warn!(
                "SECRETS_ENCRYPTION_KEY not set; deriving key from JWT_SECRET (development only)"
            );
            Sha256::digest(jwt.as_bytes()).into()
        } else {
            anyhow::bail!("SECRETS_ENCRYPTION_KEY or JWT_SECRET is required for CI secrets");
        };

        Ok(Self {
            cipher: Aes256Gcm::new(&key.into()),
        })
    }

    pub fn encrypt(&self, plaintext: &str) -> anyhow::Result<Vec<u8>> {
        let mut nonce_bytes = [0u8; NONCE_LEN];
        aes_gcm::aead::rand_core::RngCore::fill_bytes(&mut OsRng, &mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);
        let ciphertext = self
            .cipher
            .encrypt(nonce, plaintext.as_bytes())
            .map_err(|e| anyhow::anyhow!("encrypt secret: {e}"))?;
        let mut out = Vec::with_capacity(NONCE_LEN + ciphertext.len());
        out.extend_from_slice(&nonce_bytes);
        out.extend_from_slice(&ciphertext);
        Ok(out)
    }

    pub fn decrypt(&self, blob: &[u8]) -> anyhow::Result<String> {
        if blob.len() <= NONCE_LEN {
            anyhow::bail!("invalid encrypted secret blob");
        }
        let (nonce_bytes, ciphertext) = blob.split_at(NONCE_LEN);
        let nonce = Nonce::from_slice(nonce_bytes);
        let plain = self
            .cipher
            .decrypt(nonce, ciphertext)
            .map_err(|e| anyhow::anyhow!("decrypt secret: {e}"))?;
        Ok(String::from_utf8(plain)?)
    }
}

fn decode_key(raw: &str) -> anyhow::Result<[u8; 32]> {
    let trimmed = raw.trim();
    if let Ok(bytes) = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        trimmed,
    ) {
        if bytes.len() == 32 {
            let mut key = [0u8; 32];
            key.copy_from_slice(&bytes);
            return Ok(key);
        }
    }
    if trimmed.len() == 64 && trimmed.chars().all(|c| c.is_ascii_hexdigit()) {
        let mut key = [0u8; 32];
        for (i, chunk) in trimmed.as_bytes().chunks(2).enumerate() {
            let hex = std::str::from_utf8(chunk)?;
            key[i] = u8::from_str_radix(hex, 16)?;
        }
        return Ok(key);
    }
    anyhow::bail!("SECRETS_ENCRYPTION_KEY must be 32-byte base64 or 64-char hex")
}
