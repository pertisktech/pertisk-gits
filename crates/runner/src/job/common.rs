use std::collections::HashMap;
use std::path::Path;

use uuid::Uuid;

use crate::api::RunnerApi;

pub struct PreparedSecrets {
    pub injection: HashMap<String, String>,
    pub mask_values: Vec<String>,
}

/// Build step environment from injected secrets/variables, overlaying the workspace path.
pub fn build_job_env(
    secrets: &HashMap<String, String>,
    project_dir: &str,
) -> Vec<(String, String)> {
    let mut env = secrets.clone();
    env.insert("CI_PROJECT_DIR".into(), project_dir.into());
    let mut pairs: Vec<_> = env.into_iter().collect();
    pairs.sort_by(|a, b| a.0.cmp(&b.0));
    pairs
}

pub async fn prepare_secrets(
    api: &RunnerApi,
    job_id: Uuid,
    work_root: &Path,
) -> anyhow::Result<PreparedSecrets> {
    let response = match api.fetch_job_secrets(job_id).await {
        Ok(response) => response,
        Err(err) => {
            tracing::warn!(%err, "failed to load job secrets; continuing without secrets");
            crate::api::JobSecretsResponse { secrets: vec![] }
        }
    };

    let secrets_dir = work_root.join(".pertisk-secrets");
    std::fs::create_dir_all(&secrets_dir)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&secrets_dir, std::fs::Permissions::from_mode(0o700))?;
    }

    let mut injection = HashMap::new();
    let mut mask_values = Vec::new();

    for item in response.secrets {
        if item.masked && item.value.len() >= 4 {
            mask_values.push(item.value.clone());
        }
        let value = if item.secret_kind == "file" {
            let path = secrets_dir.join(&item.name);
            std::fs::write(&path, &item.value)?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))?;
            }
            path.display().to_string()
        } else {
            item.value.clone()
        };
        injection.insert(item.name, value);
    }

    Ok(PreparedSecrets {
        injection,
        mask_values,
    })
}

pub fn runner_executor() -> String {
    std::env::var("PERTISK_RUNNER_EXECUTOR").unwrap_or_else(|_| "shell".into())
}

pub fn is_kubernetes_executor() -> bool {
    matches!(
        runner_executor().to_lowercase().as_str(),
        "kubernetes" | "k8s" | "kube"
    )
}
