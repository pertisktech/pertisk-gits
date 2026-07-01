use std::path::{Path, PathBuf};

pub struct GitConfig {
    pub host: String,
    pub port: u16,
    pub database_url: String,
    pub repos_root: PathBuf,
    pub public_base_url: String,
}

impl GitConfig {
    pub fn from_env() -> anyhow::Result<Self> {
        let repos_root = std::env::var("REPOS_ROOT").unwrap_or_else(|_| "data/repos".into());
        let public_base_url = std::env::var("GIT_PUBLIC_BASE_URL")
            .unwrap_or_else(|_| "http://localhost:8080".into());

        Ok(Self {
            host: std::env::var("GIT_HTTP_HOST").unwrap_or_else(|_| "0.0.0.0".into()),
            port: std::env::var("GIT_HTTP_PORT")
                .unwrap_or_else(|_| "8082".into())
                .parse()?,
            database_url: std::env::var("DATABASE_URL")
                .map_err(|_| anyhow::anyhow!("DATABASE_URL is required"))?,
            repos_root: PathBuf::from(repos_root),
            public_base_url: public_base_url.trim_end_matches('/').to_string(),
        })
    }

    pub fn clone_url(&self, org_slug: &str, repo_slug: &str) -> String {
        format!("{}/{org_slug}/{repo_slug}.git", self.public_base_url)
    }
}

pub fn repo_disk_path(root: &Path, org_path: &str, repo_slug: &str) -> PathBuf {
    let mut path = root.to_path_buf();
    for segment in org_path.split('/').filter(|s| !s.is_empty()) {
        path.push(segment);
    }
    path.push(format!("{repo_slug}.git"));
    path
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clone_url_format() {
        let cfg = GitConfig {
            host: "0.0.0.0".into(),
            port: 8082,
            database_url: "postgres://localhost/test".into(),
            repos_root: PathBuf::from("data/repos"),
            public_base_url: "http://git.example.com".into(),
        };
        assert_eq!(
            cfg.clone_url("acme", "widget"),
            "http://git.example.com/acme/widget.git"
        );
    }

    #[test]
    fn repo_disk_path_nested() {
        let root = Path::new("/data/repos");
        let path = repo_disk_path(root, "a/b/c", "repo");
        assert_eq!(path, PathBuf::from("/data/repos/a/b/c/repo.git"));
    }

    #[test]
    fn repo_disk_path_skips_empty_segments() {
        let root = Path::new("/data/repos");
        let path = repo_disk_path(root, "/a//b/", "repo");
        assert_eq!(path, PathBuf::from("/data/repos/a/b/repo.git"));
    }

    #[test]
    fn from_env_reads_configuration() {
        let repos = tempfile::TempDir::new().unwrap();
        std::env::set_var("REPOS_ROOT", repos.path());
        std::env::set_var("GIT_PUBLIC_BASE_URL", "https://git.example.com/");
        std::env::set_var("GIT_HTTP_HOST", "127.0.0.1");
        std::env::set_var("GIT_HTTP_PORT", "9090");
        std::env::set_var("DATABASE_URL", "postgres://localhost/test");

        let cfg = GitConfig::from_env().unwrap();
        assert_eq!(cfg.host, "127.0.0.1");
        assert_eq!(cfg.port, 9090);
        assert_eq!(cfg.public_base_url, "https://git.example.com");
        assert_eq!(cfg.repos_root, repos.path());

        std::env::remove_var("REPOS_ROOT");
        std::env::remove_var("GIT_PUBLIC_BASE_URL");
        std::env::remove_var("GIT_HTTP_HOST");
        std::env::remove_var("GIT_HTTP_PORT");
        std::env::remove_var("DATABASE_URL");
    }
}
