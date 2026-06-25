use std::path::PathBuf;

use anyhow::Context;
use async_trait::async_trait;
use tokio::io::AsyncWriteExt;

#[async_trait]
pub trait BlobBackend: Send + Sync {
    async fn get(&self, key: &str) -> anyhow::Result<Vec<u8>>;
    async fn put(&self, key: &str, data: &[u8]) -> anyhow::Result<()>;
    async fn exists(&self, key: &str) -> bool;
    async fn delete(&self, key: &str) -> anyhow::Result<()>;
}

#[derive(Clone)]
pub enum StorageBackend {
    Local(LocalBackend),
    S3(S3Backend),
}

impl StorageBackend {
    pub fn from_env(local_root: &PathBuf) -> anyhow::Result<Self> {
        match std::env::var("REGISTRY_STORAGE")
            .unwrap_or_else(|_| "local".into())
            .to_lowercase()
            .as_str()
        {
            "s3" | "minio" => Ok(Self::S3(S3Backend::from_env()?)),
            _ => Ok(Self::local(local_root.clone())?),
        }
    }

    pub fn local(root: PathBuf) -> anyhow::Result<Self> {
        std::fs::create_dir_all(root.join("blobs"))?;
        std::fs::create_dir_all(root.join("uploads"))?;
        Ok(Self::Local(LocalBackend { root }))
    }

    pub async fn get(&self, key: &str) -> anyhow::Result<Vec<u8>> {
        match self {
            Self::Local(b) => b.get(key).await,
            Self::S3(b) => b.get(key).await,
        }
    }

    pub async fn put(&self, key: &str, data: &[u8]) -> anyhow::Result<()> {
        match self {
            Self::Local(b) => b.put(key, data).await,
            Self::S3(b) => b.put(key, data).await,
        }
    }

    pub async fn exists(&self, key: &str) -> bool {
        match self {
            Self::Local(b) => b.exists(key).await,
            Self::S3(b) => b.exists(key).await,
        }
    }

    pub async fn delete(&self, key: &str) -> anyhow::Result<()> {
        match self {
            Self::Local(b) => b.delete(key).await,
            Self::S3(b) => b.delete(key).await,
        }
    }

    pub async fn put_path(&self, key: &str, path: &std::path::Path) -> anyhow::Result<()> {
        match self {
            Self::Local(b) => b.put_path(key, path).await,
            Self::S3(b) => b.put_path(key, path).await,
        }
    }
}

#[derive(Clone)]
pub struct LocalBackend {
    root: PathBuf,
}

impl LocalBackend {
    fn path(&self, key: &str) -> PathBuf {
        self.root.join(key)
    }

    async fn put_path(&self, key: &str, src: &std::path::Path) -> anyhow::Result<()> {
        let dest = self.path(key);
        if let Some(parent) = dest.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        tokio::fs::copy(src, &dest).await?;
        Ok(())
    }
}

#[async_trait]
impl BlobBackend for LocalBackend {
    async fn get(&self, key: &str) -> anyhow::Result<Vec<u8>> {
        tokio::fs::read(self.path(key))
            .await
            .with_context(|| format!("read {}", self.path(key).display()))
    }

    async fn put(&self, key: &str, data: &[u8]) -> anyhow::Result<()> {
        let path = self.path(key);
        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        let mut file = tokio::fs::File::create(&path).await?;
        file.write_all(data).await?;
        file.flush().await?;
        Ok(())
    }

    async fn exists(&self, key: &str) -> bool {
        self.path(key).is_file()
    }

    async fn delete(&self, key: &str) -> anyhow::Result<()> {
        let path = self.path(key);
        if path.is_file() {
            tokio::fs::remove_file(path).await?;
        }
        Ok(())
    }
}

#[derive(Clone)]
pub struct S3Backend {
    client: aws_sdk_s3::Client,
    bucket: String,
}

impl S3Backend {
    pub fn from_env() -> anyhow::Result<Self> {
        let endpoint = std::env::var("S3_ENDPOINT")
            .or_else(|_| std::env::var("MINIO_ENDPOINT"))
            .unwrap_or_else(|_| "http://127.0.0.1:9000".into());
        let bucket = std::env::var("S3_BUCKET")
            .or_else(|_| std::env::var("REGISTRY_S3_BUCKET"))
            .unwrap_or_else(|_| "pertisk-registry".into());
        let access_key = std::env::var("S3_ACCESS_KEY")
            .or_else(|_| std::env::var("MINIO_ROOT_USER"))
            .unwrap_or_else(|_| "pertisk".into());
        let secret_key = std::env::var("S3_SECRET_KEY")
            .or_else(|_| std::env::var("MINIO_ROOT_PASSWORD"))
            .unwrap_or_else(|_| "pertisksecret".into());
        let region = std::env::var("S3_REGION").unwrap_or_else(|_| "us-east-1".into());

        let creds = aws_credential_types::Credentials::new(
            access_key,
            secret_key,
            None,
            None,
            "pertisk-registry",
        );

        let config = aws_sdk_s3::Config::builder()
            .behavior_version_latest()
            .region(aws_sdk_s3::config::Region::new(region))
            .credentials_provider(creds)
            .endpoint_url(endpoint)
            .force_path_style(true)
            .build();

        Ok(Self {
            client: aws_sdk_s3::Client::from_conf(config),
            bucket,
        })
    }

    async fn put_path(&self, key: &str, path: &std::path::Path) -> anyhow::Result<()> {
        let body = aws_sdk_s3::primitives::ByteStream::from_path(path)
            .await
            .with_context(|| format!("read {} for s3 upload", path.display()))?;
        self.client
            .put_object()
            .bucket(&self.bucket)
            .key(key)
            .body(body)
            .send()
            .await
            .with_context(|| format!("s3 put s3://{}/{}", self.bucket, key))?;
        Ok(())
    }
}

#[async_trait]
impl BlobBackend for S3Backend {
    async fn get(&self, key: &str) -> anyhow::Result<Vec<u8>> {
        let out = self
            .client
            .get_object()
            .bucket(&self.bucket)
            .key(key)
            .send()
            .await
            .with_context(|| format!("s3 get s3://{}/{}", self.bucket, key))?;
        let data = out.body.collect().await?.into_bytes();
        Ok(data.to_vec())
    }

    async fn put(&self, key: &str, data: &[u8]) -> anyhow::Result<()> {
        self.client
            .put_object()
            .bucket(&self.bucket)
            .key(key)
            .body(aws_sdk_s3::primitives::ByteStream::from(data.to_vec()))
            .send()
            .await
            .with_context(|| format!("s3 put s3://{}/{}", self.bucket, key))?;
        Ok(())
    }

    async fn exists(&self, key: &str) -> bool {
        self.client
            .head_object()
            .bucket(&self.bucket)
            .key(key)
            .send()
            .await
            .is_ok()
    }

    async fn delete(&self, key: &str) -> anyhow::Result<()> {
        self.client
            .delete_object()
            .bucket(&self.bucket)
            .key(key)
            .send()
            .await
            .with_context(|| format!("s3 delete s3://{}/{}", self.bucket, key))?;
        Ok(())
    }
}
