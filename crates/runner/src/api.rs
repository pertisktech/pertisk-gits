use anyhow::Context;
use pertisk_cicd::config::Step;
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

#[derive(Deserialize)]
pub struct PollJobResponse {
    pub job_id: Uuid,
    pub job_name: String,
    pub org_slug: String,
    pub repo_slug: String,
    pub commit_sha: String,
    pub steps: Vec<Step>,
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
        self.client
            .post(format!("{}/api/v1/runner/jobs/{job_id}/complete", self.base_url))
            .bearer_auth(&self.token)
            .json(&body)
            .send()
            .await?;
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
}
