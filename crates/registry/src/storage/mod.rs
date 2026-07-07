use std::path::{Path, PathBuf};

use anyhow::Context;
use sha2::{Digest, Sha256};
use tokio::io::AsyncReadExt;
use tokio::io::AsyncWriteExt;
use uuid::Uuid;

mod backend;

pub use backend::{check_s3_health, registry_uses_s3_storage, BlobBackend, S3HealthReport, StorageBackend};

#[derive(Clone)]
pub struct BlobStore {
    backend: StorageBackend,
    root: PathBuf,
}

impl BlobStore {
    pub fn from_config(config: &crate::config::RegistryConfig) -> anyhow::Result<Self> {
        std::fs::create_dir_all(config.registry_root.join("uploads"))?;
        let backend = StorageBackend::from_env(&config.registry_root)?;
        Ok(Self {
            backend,
            root: config.registry_root.clone(),
        })
    }

    pub fn new_local(root: PathBuf) -> anyhow::Result<Self> {
        std::fs::create_dir_all(root.join("blobs"))?;
        std::fs::create_dir_all(root.join("uploads"))?;
        Ok(Self {
            backend: StorageBackend::local(root.clone())?,
            root,
        })
    }

    pub fn blob_key(digest: &str) -> String {
        let hex = digest.strip_prefix("sha256:").unwrap_or(digest);
        let (prefix, rest) = hex.split_at(2.min(hex.len()));
        format!("blobs/{prefix}/{rest}")
    }

    pub fn upload_path(&self, upload_id: &Uuid) -> PathBuf {
        self.root.join("uploads").join(upload_id.to_string())
    }

    pub async fn write_blob(&self, digest: &str, data: &[u8]) -> anyhow::Result<String> {
        let key = Self::blob_key(digest);
        self.backend.put(&key, data).await?;
        Ok(key)
    }

    pub async fn read_blob(&self, digest: &str) -> anyhow::Result<Vec<u8>> {
        self.backend
            .get(&Self::blob_key(digest))
            .await
            .with_context(|| format!("read blob {digest}"))
    }

    pub async fn blob_exists(&self, digest: &str) -> bool {
        self.backend.exists(&Self::blob_key(digest)).await
    }

    pub async fn delete_blob(&self, digest: &str) -> anyhow::Result<()> {
        self.backend.delete(&Self::blob_key(digest)).await
    }

    pub async fn write_upload(&self, upload_id: &Uuid, data: &[u8]) -> anyhow::Result<()> {
        let path = self.upload_path(upload_id);
        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        tokio::fs::write(&path, data).await?;
        Ok(())
    }

    pub async fn finalize_upload(
        &self,
        upload_id: &Uuid,
        expected_digest: &str,
    ) -> anyhow::Result<(String, i64)> {
        let upload_path = self.upload_path(upload_id);
        let meta = tokio::fs::metadata(&upload_path)
            .await
            .with_context(|| format!("upload {upload_id} not found"))?;
        if meta.len() == 0 {
            anyhow::bail!("upload file is empty");
        }

        let digest = sha256_digest_file(&upload_path).await?;
        if digest != expected_digest {
            anyhow::bail!("digest mismatch: got {digest}, expected {expected_digest}");
        }

        let key = Self::blob_key(expected_digest);
        if !self.backend.exists(&key).await {
            self.backend
                .put_path(&key, &upload_path)
                .await
                .with_context(|| format!("store blob {expected_digest}"))?;
        }

        let size = meta.len() as i64;
        let _ = tokio::fs::remove_file(&upload_path).await;
        Ok((key, size))
    }

    pub async fn append_upload(&self, upload_id: &Uuid, chunk: &[u8]) -> anyhow::Result<()> {
        let path = self.upload_path(upload_id);
        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        let mut file = tokio::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .await?;
        file.write_all(chunk).await?;
        file.flush().await?;
        Ok(())
    }

    pub fn create_upload(&self) -> Uuid {
        let _ = std::fs::create_dir_all(self.root.join("uploads"));
        Uuid::new_v4()
    }

    pub async fn upload_size(&self, upload_id: &Uuid) -> anyhow::Result<u64> {
        let path = self.upload_path(upload_id);
        let meta = tokio::fs::metadata(path).await?;
        Ok(meta.len())
    }

    pub fn relative_storage_path(&self, key: &str) -> String {
        key.to_string()
    }

    pub async fn cleanup_stale_uploads(&self, max_age_hours: i64) -> anyhow::Result<u32> {
        let uploads_dir = self.root.join("uploads");
        if !uploads_dir.is_dir() {
            return Ok(0);
        }
        let cutoff = chrono::Utc::now() - chrono::Duration::hours(max_age_hours);
        let mut removed = 0u32;
        let mut entries = tokio::fs::read_dir(&uploads_dir).await?;
        while let Some(entry) = entries.next_entry().await? {
            let meta = entry.metadata().await?;
            if let Ok(modified) = meta.modified() {
                let modified: chrono::DateTime<chrono::Utc> = modified.into();
                if modified < cutoff {
                    tokio::fs::remove_file(entry.path()).await.ok();
                    removed += 1;
                }
            }
        }
        Ok(removed)
    }
}

pub fn sha256_digest(data: &[u8]) -> String {
    let hash = Sha256::digest(data);
    format!("sha256:{}", hex::encode(hash))
}

pub async fn sha256_digest_file(path: &Path) -> anyhow::Result<String> {
    let mut file = tokio::fs::File::open(path).await?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 1024 * 1024];
    loop {
        let n = file.read(&mut buf).await?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(format!("sha256:{}", hex::encode(hasher.finalize())))
}

mod hex {
    pub fn encode(bytes: impl AsRef<[u8]>) -> String {
        bytes
            .as_ref()
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn digest_format() {
        assert_eq!(
            sha256_digest(b"hello"),
            "sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
        );
    }

    #[test]
    fn blob_key_layout() {
        assert_eq!(
            BlobStore::blob_key("sha256:abcd"),
            "blobs/ab/cd"
        );
    }

    #[tokio::test]
    async fn monolithic_upload_finalize() {
        let dir = std::env::temp_dir().join(format!("pertisk-registry-test-{}", Uuid::new_v4()));
        let store = BlobStore::new_local(dir.clone()).unwrap();
        let upload_id = store.create_upload();
        let data = b"hello blob";
        let digest = sha256_digest(data);

        store.write_upload(&upload_id, data).await.unwrap();
        let (key, size) = store.finalize_upload(&upload_id, &digest).await.unwrap();

        assert_eq!(size, data.len() as i64);
        assert!(store.blob_exists(&digest).await);
        assert_eq!(store.read_blob(&digest).await.unwrap(), data);
        assert!(key.starts_with("blobs/"));

        let _ = std::fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn write_and_delete_blob() {
        let dir = std::env::temp_dir().join(format!("pertisk-registry-test-{}", Uuid::new_v4()));
        let store = BlobStore::new_local(dir.clone()).unwrap();
        let data = b"registry blob";
        let digest = sha256_digest(data);
        store.write_blob(&digest, data).await.unwrap();
        assert!(store.blob_exists(&digest).await);
        assert_eq!(store.read_blob(&digest).await.unwrap(), data);
        store.delete_blob(&digest).await.unwrap();
        assert!(!store.blob_exists(&digest).await);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn finalize_upload_rejects_digest_mismatch() {
        let dir = std::env::temp_dir().join(format!("pertisk-registry-test-{}", Uuid::new_v4()));
        let store = BlobStore::new_local(dir.clone()).unwrap();
        let upload_id = store.create_upload();
        store.write_upload(&upload_id, b"payload").await.unwrap();
        let wrong = sha256_digest(b"other");
        let err = store.finalize_upload(&upload_id, &wrong).await.unwrap_err();
        assert!(err.to_string().contains("digest mismatch"));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn append_upload_chunks() {
        let dir = std::env::temp_dir().join(format!("pertisk-registry-test-{}", Uuid::new_v4()));
        let store = BlobStore::new_local(dir.clone()).unwrap();
        let upload_id = store.create_upload();
        store.append_upload(&upload_id, b"hel").await.unwrap();
        store.append_upload(&upload_id, b"lo").await.unwrap();
        let digest = sha256_digest(b"hello");
        store.finalize_upload(&upload_id, &digest).await.unwrap();
        assert_eq!(store.read_blob(&digest).await.unwrap(), b"hello");
        let _ = std::fs::remove_dir_all(dir);
    }
}
