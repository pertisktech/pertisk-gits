use anyhow::Context;
use chrono::{DateTime, Utc};
use pertisk_cicd::config::Step;
use pertisk_cicd::ArtifactDecl;
use reqwest::StatusCode;
use serde::Deserialize;
use serde_json::Value;
use uuid::Uuid;

use crate::host::HostInfo;

pub struct RunnerApi {
    pub client: reqwest::Client,
    pub base_url: String,
    pub token: String,
}

#[derive(Clone, Deserialize)]
pub struct PollJobResponse {
    pub job_id: Uuid,
    #[serde(default = "default_uuid")]
    pub pipeline_run_id: Uuid,
    pub job_name: String,
    #[serde(default = "default_uuid")]
    pub repository_id: Uuid,
    pub org_slug: String,
    pub repo_slug: String,
    #[serde(default)]
    pub repo_name: String,
    pub commit_sha: String,
    #[serde(default)]
    pub ref_name: String,
    #[serde(default = "default_event_type")]
    pub event_type: String,
    #[serde(default)]
    pub pipeline_iid: i64,
    #[serde(default = "default_timestamp")]
    pub pipeline_created_at: DateTime<Utc>,
    #[serde(default)]
    pub config_path: Option<String>,
    #[serde(default)]
    pub target_environment: Option<String>,
    #[serde(default)]
    pub effective_environment: Option<String>,
    #[serde(default = "default_branch_name")]
    pub default_branch: String,
    #[serde(default)]
    pub pull_request_number: Option<i32>,
    pub steps: Vec<Step>,
    #[serde(default)]
    pub artifacts: Vec<ArtifactDecl>,
    #[serde(default)]
    pub timeout_minutes: Option<u32>,
    #[serde(default)]
    pub image: Option<String>,
    #[serde(default)]
    pub dind: bool,
}

fn default_uuid() -> Uuid {
    Uuid::nil()
}

fn default_event_type() -> String {
    "push".into()
}

fn default_timestamp() -> DateTime<Utc> {
    Utc::now()
}

fn default_branch_name() -> String {
    "main".into()
}

#[derive(Debug, Clone, Deserialize)]
pub struct JobControlState {
    pub pipeline_cancelled: bool,
    pub job_cancelled: bool,
    pub cancel_requested: bool,
    pub cancel_step_name: Option<String>,
    #[serde(default)]
    pub timed_out: bool,
}

impl JobControlState {
    pub fn should_cancel_job(&self) -> bool {
        self.pipeline_cancelled || self.job_cancelled || self.timed_out
    }

    pub fn should_cancel_step(&self, step_name: &str) -> bool {
        if self.should_cancel_job() {
            return true;
        }
        if !self.cancel_requested {
            return false;
        }
        match self.cancel_step_name.as_deref() {
            None => true,
            Some(want) => want == step_name,
        }
    }
}

impl RunnerApi {
    pub fn new(api_url: &str, token: String) -> Self {
        Self {
            client: reqwest::Client::new(),
            base_url: api_url.trim_end_matches('/').to_string(),
            token,
        }
    }

    pub async fn heartbeat(&self, host: &HostInfo) -> anyhow::Result<()> {
        self.client
            .post(format!("{}/api/v1/runner/heartbeat", self.base_url))
            .bearer_auth(&self.token)
            .json(host)
            .send()
            .await?;
        Ok(())
    }

    pub async fn deregister_instance(&self, host: &HostInfo) -> anyhow::Result<()> {
        self.client
            .delete(format!("{}/api/v1/runner/instance", self.base_url))
            .bearer_auth(&self.token)
            .json(host)
            .send()
            .await?;
        Ok(())
    }

    pub async fn poll_job(&self, timeout_secs: u64) -> anyhow::Result<Option<PollJobResponse>> {
        let response = self
            .client
            .get(format!("{}/api/v1/runner/jobs", self.base_url))
            .query(&[("timeout_secs", timeout_secs.to_string())])
            .bearer_auth(&self.token)
            .send()
            .await
            .context("poll jobs")?;

        if response.status() == StatusCode::UNAUTHORIZED {
            anyhow::bail!("unauthorized");
        }
        if !response.status().is_success() {
            anyhow::bail!("poll failed: {}", response.status());
        }

        Ok(response.json().await?)
    }

    pub async fn start_job(&self, job_id: Uuid) -> anyhow::Result<()> {
        self.client
            .post(format!("{}/api/v1/runner/jobs/{job_id}/start", self.base_url))
            .bearer_auth(&self.token)
            .send()
            .await?;
        Ok(())
    }

    pub async fn append_log(&self, job_id: Uuid, chunk: &str) -> anyhow::Result<()> {
        if chunk.is_empty() {
            return Ok(());
        }
        self.client
            .post(format!("{}/api/v1/runner/jobs/{job_id}/log", self.base_url))
            .bearer_auth(&self.token)
            .json(&serde_json::json!({ "append": chunk }))
            .send()
            .await?;
        Ok(())
    }

    pub async fn complete_job(
        &self,
        job_id: Uuid,
        status: &str,
        log_text: Option<&str>,
        metrics_json: Option<Value>,
    ) -> anyhow::Result<()> {
        let mut body = serde_json::json!({
            "status": status,
            "metrics_json": metrics_json,
        });
        if let Some(log) = log_text {
            body["log_text"] = Value::String(log.to_string());
        }
        let response = self
            .client
            .post(format!("{}/api/v1/runner/jobs/{job_id}/complete", self.base_url))
            .bearer_auth(&self.token)
            .json(&body)
            .send()
            .await?;
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            anyhow::bail!("complete job failed ({status}): {body}");
        }
        Ok(())
    }

    pub async fn upsert_k8s_pod(
        &self,
        job_id: Uuid,
        k8s_namespace: &str,
        k8s_job_name: &str,
        k8s_pod_name: Option<&str>,
        phase: &str,
        finished: bool,
    ) -> anyhow::Result<()> {
        let body = serde_json::json!({
            "k8s_namespace": k8s_namespace,
            "k8s_job_name": k8s_job_name,
            "k8s_pod_name": k8s_pod_name,
            "phase": phase,
            "finished": finished,
        });
        let response = self
            .client
            .put(format!("{}/api/v1/runner/jobs/{job_id}/k8s-pod", self.base_url))
            .bearer_auth(&self.token)
            .json(&body)
            .send()
            .await
            .context("upsert k8s pod")?;
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            anyhow::bail!("upsert k8s pod failed ({status}): {body}");
        }
        Ok(())
    }

    pub async fn download_workspace(&self, job_id: Uuid) -> anyhow::Result<bytes::Bytes> {
        let response = self
            .client
            .get(format!("{}/api/v1/runner/jobs/{job_id}/workspace", self.base_url))
            .bearer_auth(&self.token)
            .send()
            .await
            .context("download workspace from API")?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            anyhow::bail!("API workspace download failed ({status}): {body}");
        }

        response.bytes().await.context("read workspace archive")
    }

    pub async fn upload_artifact(
        &self,
        job_id: Uuid,
        name: &str,
        rel_path: &str,
        data: Vec<u8>,
    ) -> anyhow::Result<()> {
        let part = reqwest::multipart::Part::bytes(data)
            .file_name(format!("{name}.tar.gz"))
            .mime_str("application/gzip")?;
        let form = reqwest::multipart::Form::new()
            .text("name", name.to_string())
            .text("path", rel_path.to_string())
            .part("file", part);

        let response = self
            .client
            .post(format!("{}/api/v1/runner/jobs/{job_id}/artifacts", self.base_url))
            .bearer_auth(&self.token)
            .multipart(form)
            .send()
            .await
            .context("upload artifact")?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            anyhow::bail!("artifact upload failed ({status}): {body}");
        }

        Ok(())
    }

    pub async fn fetch_job_control(&self, job_id: Uuid) -> anyhow::Result<JobControlState> {
        let response = self
            .client
            .get(format!("{}/api/v1/runner/jobs/{job_id}/control", self.base_url))
            .bearer_auth(&self.token)
            .send()
            .await
            .context("fetch job control")?;

        if !response.status().is_success() {
            anyhow::bail!("job control failed: {}", response.status());
        }

        Ok(response.json().await?)
    }

    pub async fn fetch_job_secrets(&self, job_id: Uuid) -> anyhow::Result<JobSecretsResponse> {
        let response = self
            .client
            .get(format!("{}/api/v1/runner/jobs/{job_id}/secrets", self.base_url))
            .bearer_auth(&self.token)
            .send()
            .await
            .context("fetch job secrets")?;

        if !response.status().is_success() {
            anyhow::bail!("job secrets failed: {}", response.status());
        }

        Ok(response.json().await?)
    }
}

impl RunnerApi {
    pub fn clone_for_poll(&self) -> Self {
        Self {
            client: self.client.clone(),
            base_url: self.base_url.clone(),
            token: self.token.clone(),
        }
    }

    pub fn api_url(&self) -> &str {
        &self.base_url
    }

    pub fn token(&self) -> &str {
        &self.token
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct JobSecretItem {
    pub name: String,
    pub secret_kind: String,
    pub value: String,
    #[serde(default = "default_true")]
    pub masked: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Deserialize)]
pub struct JobSecretsResponse {
    pub secrets: Vec<JobSecretItem>,
}
