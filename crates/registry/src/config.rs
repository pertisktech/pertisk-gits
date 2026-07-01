use std::path::PathBuf;

pub struct RegistryConfig {
    pub host: String,
    pub port: u16,
    pub database_url: String,
    pub registry_root: PathBuf,
    pub jwt_secret: String,
    pub public_base_url: String,
    pub service_name: String,
    /// When true, unauthenticated `docker pull` is allowed for images linked to public git repos.
    pub allow_anonymous_pull: bool,
}

impl RegistryConfig {
    pub fn from_env() -> anyhow::Result<Self> {
        let public_base_url = std::env::var("REGISTRY_PUBLIC_BASE_URL")
            .or_else(|_| std::env::var("GIT_PUBLIC_BASE_URL"))
            .unwrap_or_else(|_| "http://localhost:8080".into());

        Ok(Self {
            host: std::env::var("REGISTRY_HOST").unwrap_or_else(|_| "0.0.0.0".into()),
            port: std::env::var("REGISTRY_PORT")
                .unwrap_or_else(|_| "8083".into())
                .parse()?,
            database_url: std::env::var("DATABASE_URL")
                .map_err(|_| anyhow::anyhow!("DATABASE_URL is required"))?,
            registry_root: PathBuf::from(
                std::env::var("REGISTRY_ROOT").unwrap_or_else(|_| "data/registry".into()),
            ),
            jwt_secret: std::env::var("JWT_SECRET")
                .map_err(|_| anyhow::anyhow!("JWT_SECRET is required"))?,
            public_base_url: public_base_url.trim_end_matches('/').to_string(),
            service_name: std::env::var("REGISTRY_SERVICE_NAME")
                .unwrap_or_else(|_| "pertisk-registry".into()),
            allow_anonymous_pull: Self::allow_anonymous_pull(),
        })
    }

    pub fn token_url(&self) -> String {
        format!("{}/service/token", self.public_base_url)
    }

    pub fn allow_anonymous_pull() -> bool {
        std::env::var("REGISTRY_ALLOW_ANONYMOUS_PULL")
            .map(|v| v != "0" && !v.eq_ignore_ascii_case("false"))
            .unwrap_or(true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_url_joins_base() {
        let cfg = RegistryConfig {
            host: "0.0.0.0".into(),
            port: 8083,
            database_url: "postgres://localhost/test".into(),
            registry_root: PathBuf::from("data/registry"),
            jwt_secret: "secret".into(),
            public_base_url: "https://registry.example.com".into(),
            service_name: "pertisk-registry".into(),
            allow_anonymous_pull: true,
        };
        assert_eq!(
            cfg.token_url(),
            "https://registry.example.com/service/token"
        );
    }
}
