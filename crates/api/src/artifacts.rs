use std::path::PathBuf;

use anyhow::Context;
use tokio::io::AsyncWriteExt;
use uuid::Uuid;

#[derive(Clone)]
pub struct ArtifactStore {
    root: PathBuf,
}

impl ArtifactStore {
    pub fn from_env() -> anyhow::Result<Self> {
        let root = std::env::var("ARTIFACTS_ROOT").unwrap_or_else(|_| "data/artifacts".into());
        let store = Self {
            root: PathBuf::from(root),
        };
        std::fs::create_dir_all(&store.root)
            .with_context(|| format!("create artifacts root {}", store.root.display()))?;
        Ok(store)
    }

    pub fn storage_key(job_run_id: Uuid, name: &str) -> String {
        format!("{job_run_id}/{name}.tar.gz")
    }

    pub async fn put(&self, storage_key: &str, data: &[u8]) -> anyhow::Result<()> {
        let path = self.root.join(storage_key);
        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        let mut file = tokio::fs::File::create(&path).await?;
        file.write_all(data).await?;
        file.flush().await?;
        Ok(())
    }

    pub async fn get(&self, storage_key: &str) -> anyhow::Result<Vec<u8>> {
        let path = self.root.join(storage_key);
        tokio::fs::read(&path)
            .await
            .with_context(|| format!("read artifact {}", path.display()))
    }

    pub fn resolve_path(&self, storage_key: &str) -> PathBuf {
        self.root.join(storage_key)
    }

    pub fn exists(&self, storage_key: &str) -> bool {
        self.root.join(storage_key).is_file()
    }
}

pub fn sanitize_artifact_name(name: &str) -> String {
    name.chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.' { c } else { '_' })
        .collect()
}

pub fn download_filename(name: &str) -> String {
    let safe = sanitize_artifact_name(name);
    if safe.ends_with(".tar.gz") {
        safe
    } else {
        format!("{safe}.tar.gz")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitizes_names() {
        assert_eq!(sanitize_artifact_name("my build"), "my_build");
    }
}
