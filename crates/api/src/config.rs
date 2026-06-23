use std::path::PathBuf;

pub struct Config {
    pub host: String,
    pub port: u16,
    pub database_url: String,
    pub jwt_secret: String,
    pub repos_root: PathBuf,
    pub git_public_base_url: String,
    pub git_ssh_public_host: Option<String>,
    pub git_ssh_port: Option<u16>,
    pub git_ssh_host_key_path: PathBuf,
    /// When set, static SPA files are served on `/` (single-port deploy).
    pub web_dist: Option<PathBuf>,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let repos_root = std::env::var("REPOS_ROOT").unwrap_or_else(|_| "data/repos".into());
        let git_public_base_url = std::env::var("GIT_PUBLIC_BASE_URL")
            .unwrap_or_else(|_| "http://localhost:8080".into());
        let web_dist = std::env::var("WEB_DIST")
            .ok()
            .filter(|s| !s.is_empty())
            .map(PathBuf::from);

        let git_ssh_port = std::env::var("GIT_SSH_PORT")
            .ok()
            .filter(|s| !s.is_empty())
            .map(|s| s.parse())
            .transpose()?;

        let git_ssh_public_host = std::env::var("GIT_SSH_PUBLIC_HOST")
            .ok()
            .filter(|s| !s.is_empty());

        let git_ssh_host_key_path = std::env::var("GIT_SSH_HOST_KEY_PATH")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("data/ssh_host_key"));

        Ok(Self {
            host: std::env::var("API_HOST").unwrap_or_else(|_| "0.0.0.0".into()),
            port: std::env::var("API_PORT")
                .unwrap_or_else(|_| "8081".into())
                .parse()?,
            database_url: std::env::var("DATABASE_URL")
                .map_err(|_| anyhow::anyhow!("DATABASE_URL is required"))?,
            jwt_secret: std::env::var("JWT_SECRET")
                .map_err(|_| anyhow::anyhow!("JWT_SECRET is required"))?,
            repos_root: PathBuf::from(repos_root),
            git_public_base_url: git_public_base_url.trim_end_matches('/').to_string(),
            git_ssh_public_host,
            git_ssh_port,
            git_ssh_host_key_path,
            web_dist,
        })
    }

    pub fn clone_url_http(&self, org_slug: &str, repo_slug: &str) -> String {
        format!("{}/{org_slug}/{repo_slug}.git", self.git_public_base_url)
    }

    pub fn clone_url(&self, org_slug: &str, repo_slug: &str) -> String {
        self.clone_url_http(org_slug, repo_slug)
    }

    pub fn clone_url_ssh(&self, org_slug: &str, repo_slug: &str) -> Option<String> {
        let port = self.git_ssh_port?;
        let host = self
            .git_ssh_public_host
            .as_deref()
            .unwrap_or("localhost");
        let path = format!("{org_slug}/{repo_slug}.git");

        Some(match port {
            22 => format!("git@{host}:{path}"),
            _ => format!("ssh://git@{host}:{port}/{path}"),
        })
    }
}
