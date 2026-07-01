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
}
