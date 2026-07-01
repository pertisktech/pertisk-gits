use std::collections::HashSet;

use serde::Serialize;
use sqlx::PgPool;

use crate::storage::BlobStore;

#[derive(Debug, Default, Serialize)]
pub struct GcReport {
    pub blobs_removed: u32,
    pub upload_files_removed: u32,
}

pub async fn collect_referenced_digests(pool: &PgPool) -> anyhow::Result<HashSet<String>> {
    let manifests =
        sqlx::query_scalar::<_, Vec<u8>>("SELECT payload FROM container_manifests")
            .fetch_all(pool)
            .await?;

    let mut referenced = HashSet::new();
    for payload in manifests {
        extract_manifest_digests(&payload, &mut referenced);
    }
    Ok(referenced)
}

pub fn extract_manifest_digests(payload: &[u8], out: &mut HashSet<String>) {
    let Ok(value) = serde_json::from_slice::<serde_json::Value>(payload) else {
        return;
    };
    if let Some(d) = value
        .get("config")
        .and_then(|c| c.get("digest"))
        .and_then(|d| d.as_str())
    {
        out.insert(d.to_string());
    }
    if let Some(layers) = value.get("layers").and_then(|l| l.as_array()) {
        for layer in layers {
            if let Some(d) = layer.get("digest").and_then(|d| d.as_str()) {
                out.insert(d.to_string());
            }
        }
    }
}

pub async fn run_gc(pool: &PgPool, store: &BlobStore) -> anyhow::Result<GcReport> {
    let referenced = collect_referenced_digests(pool).await?;
    let all_blobs = sqlx::query_as::<_, (String,)>("SELECT digest FROM container_blobs")
        .fetch_all(pool)
        .await?;

    let mut blobs_removed = 0u32;
    for (digest,) in all_blobs {
        if referenced.contains(&digest) {
            continue;
        }
        if store.delete_blob(&digest).await.is_ok() {
            sqlx::query("DELETE FROM container_blobs WHERE digest = $1")
                .bind(&digest)
                .execute(pool)
                .await?;
            blobs_removed += 1;
        }
    }

    let upload_files_removed = store.cleanup_stale_uploads(24).await?;

    Ok(GcReport {
        blobs_removed,
        upload_files_removed,
    })
}

pub fn spawn_gc_loop(pool: PgPool, store: BlobStore) {
    let interval_secs = std::env::var("REGISTRY_GC_INTERVAL_SECS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(3600);

    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(interval_secs));
        loop {
            interval.tick().await;
            match run_gc(&pool, &store).await {
                Ok(report) if report.blobs_removed > 0 || report.upload_files_removed > 0 => {
                    tracing::info!(
                        blobs = report.blobs_removed,
                        uploads = report.upload_files_removed,
                        "registry garbage collection completed"
                    );
                }
                Ok(_) => {}
                Err(err) => tracing::warn!(%err, "registry garbage collection failed"),
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_manifest_digests_from_v2_manifest() {
        let payload = br#"{
            "config": { "digest": "sha256:config" },
            "layers": [
                { "digest": "sha256:layer1" },
                { "digest": "sha256:layer2" }
            ]
        }"#;
        let mut out = HashSet::new();
        extract_manifest_digests(payload, &mut out);
        assert_eq!(out.len(), 3);
        assert!(out.contains("sha256:config"));
        assert!(out.contains("sha256:layer1"));
    }

    #[test]
    fn extract_manifest_digests_ignores_invalid_json() {
        let mut out = HashSet::new();
        extract_manifest_digests(b"not json", &mut out);
        assert!(out.is_empty());
    }
}
