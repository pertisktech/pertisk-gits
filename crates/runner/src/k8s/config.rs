use std::collections::BTreeMap;

use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct K8sExecutorConfig {
    pub namespace: String,
    pub helper_image: String,
    pub build_image: String,
    pub dind_image: String,
    pub release_name: Option<String>,
    pub service_account: Option<String>,
    pub ttl_seconds_after_finished: i32,
    pub workspace_mount_path: String,
    pub node_selector: BTreeMap<String, String>,
}

impl K8sExecutorConfig {
    pub fn from_env() -> Self {
        let namespace = std::env::var("PERTISK_K8S_NAMESPACE")
            .or_else(|_| std::env::var("POD_NAMESPACE"))
            .unwrap_or_else(|_| "pertisk-ci".into());

        let mut node_selector = BTreeMap::new();
        if let Ok(raw) = std::env::var("PERTISK_K8S_NODE_SELECTOR") {
            if let Ok(map) = serde_json::from_str::<BTreeMap<String, String>>(&raw) {
                node_selector = map;
            }
        }

        Self {
            namespace,
            helper_image: std::env::var("PERTISK_K8S_HELPER_IMAGE")
                .unwrap_or_else(|_| "curlimages/curl:8.12.1".into()),
            build_image: std::env::var("PERTISK_K8S_BUILD_IMAGE")
                .unwrap_or_else(|_| "debian:bookworm-slim".into()),
            dind_image: std::env::var("PERTISK_K8S_DIND_IMAGE")
                .unwrap_or_else(|_| "docker:27.5.1-dind".into()),
            release_name: std::env::var("PERTISK_K8S_RELEASE")
                .ok()
                .filter(|name| !name.trim().is_empty()),
            service_account: std::env::var("PERTISK_K8S_SERVICE_ACCOUNT").ok(),
            ttl_seconds_after_finished: std::env::var("PERTISK_K8S_TTL_SECONDS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(600),
            workspace_mount_path: std::env::var("PERTISK_K8S_WORKSPACE")
                .unwrap_or_else(|_| "/workspace".into()),
            node_selector,
        }
    }
}

pub fn job_resource_name(job_id: Uuid) -> String {
    let short = job_id.simple().to_string();
    format!("pertisk-job-{}", &short[..12])
}
