use std::collections::HashMap;
use std::path::Path;

use pertisk_cicd::{build_predefined_vars, PredefinedCiContext, PullRequestContext};

use crate::api::{PollJobResponse, RunnerApi};

pub struct PreparedSecrets {
    pub injection: HashMap<String, String>,
    pub secret_refs: HashMap<String, String>,
    pub variable_refs: HashMap<String, String>,
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

/// GitLab-style predefined variables from poll metadata (always available to the runner).
pub fn predefined_vars_from_job(job: &PollJobResponse, server_url: &str) -> HashMap<String, String> {
    let pull_request = job.pull_request_number.map(|number| PullRequestContext {
        id: String::new(),
        number,
        title: String::new(),
        source_branch: String::new(),
        target_branch: String::new(),
    });

    let pipeline_run_id = if job.pipeline_run_id.is_nil() {
        job.job_id.to_string()
    } else {
        job.pipeline_run_id.to_string()
    };

    let ctx = PredefinedCiContext {
        server_url: server_url.trim_end_matches('/').to_string(),
        pipeline_run_id,
        pipeline_iid: job.pipeline_iid,
        pipeline_created_at: job.pipeline_created_at,
        pipeline_event: job.event_type.clone(),
        config_path: job.config_path.clone(),
        target_environment: job.target_environment.clone(),
        job_id: job.job_id.to_string(),
        job_name: job.job_name.clone(),
        effective_environment: job.effective_environment.clone(),
        commit_sha: job.commit_sha.clone(),
        ref_name: job.ref_name.clone(),
        repository_id: job.repository_id.to_string(),
        repo_name: job.repo_name.clone(),
        repo_slug: job.repo_slug.clone(),
        org_slug: job.org_slug.clone(),
        default_branch: job.default_branch.clone(),
        pull_request,
        runner_id: None,
        job_image: job.image.clone(),
    };

    build_predefined_vars(&ctx)
}

pub async fn prepare_secrets(
    api: &RunnerApi,
    job: &PollJobResponse,
    work_root: &Path,
) -> anyhow::Result<PreparedSecrets> {
    let mut injection = predefined_vars_from_job(job, api.api_url());

    let response = match api.fetch_job_secrets(job.job_id).await {
        Ok(response) => response,
        Err(err) => {
            tracing::warn!(%err, "failed to load job secrets; using predefined variables only");
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

    let mut mask_values = Vec::new();
    let mut secret_refs = predefined_vars_from_job(job, api.api_url());
    let mut variable_refs = HashMap::new();

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
        injection.insert(item.name.clone(), value.clone());
        if item.config_scope == "variable" {
            variable_refs.insert(item.name, value);
        } else {
            secret_refs.insert(item.name, value);
        }
    }

    Ok(PreparedSecrets {
        injection,
        secret_refs,
        variable_refs,
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

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use uuid::Uuid;

    #[test]
    fn build_job_env_includes_project_dir() {
        let mut secrets = HashMap::new();
        secrets.insert("CI".into(), "true".into());
        let env = build_job_env(&secrets, "/workspace/project");
        let map: HashMap<_, _> = env.into_iter().collect();
        assert_eq!(map.get("CI").map(String::as_str), Some("true"));
        assert_eq!(map.get("CI_PROJECT_DIR").map(String::as_str), Some("/workspace/project"));
    }

    #[test]
    fn predefined_vars_from_job_includes_repo_metadata() {
        let job = PollJobResponse {
            job_id: Uuid::new_v4(),
            pipeline_run_id: Uuid::new_v4(),
            job_name: "build".into(),
            repository_id: Uuid::new_v4(),
            org_slug: "acme".into(),
            repo_slug: "widget".into(),
            repo_name: "acme/widget".into(),
            commit_sha: "abc123".into(),
            ref_name: "main".into(),
            event_type: "push".into(),
            pipeline_iid: 1,
            pipeline_created_at: Utc::now(),
            config_path: Some(".pertisk-ci.yaml".into()),
            target_environment: None,
            effective_environment: None,
            default_branch: "main".into(),
            pull_request_number: None,
            steps: vec![],
            artifacts: vec![],
            timeout_minutes: None,
            image: None,
            dind: false,
        };
        let vars = predefined_vars_from_job(&job, "https://git.example.com");
        assert_eq!(vars.get("CI_JOB_NAME").map(String::as_str), Some("build"));
        assert_eq!(vars.get("CI_COMMIT_SHA").map(String::as_str), Some("abc123"));
        assert_eq!(
            vars.get("CI_SERVER_URL").map(String::as_str),
            Some("https://git.example.com")
        );
    }
}
