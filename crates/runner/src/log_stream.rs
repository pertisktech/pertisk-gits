use std::time::{Duration, Instant};

use pertisk_cicd::mask_secrets_in_text;
use uuid::Uuid;

use crate::api::RunnerApi;

const FLUSH_INTERVAL: Duration = Duration::from_millis(200);
const FLUSH_BYTES: usize = 512;

pub struct LogStreamer<'a> {
    api: &'a RunnerApi,
    job_id: Uuid,
    buffer: String,
    last_flush: Instant,
    mask_values: Vec<String>,
}

impl<'a> LogStreamer<'a> {
    pub fn new(api: &'a RunnerApi, job_id: Uuid, mask_values: Vec<String>) -> Self {
        Self {
            api,
            job_id,
            buffer: String::new(),
            last_flush: Instant::now(),
            mask_values,
        }
    }

    pub async fn push(&mut self, chunk: &str) {
        if chunk.is_empty() {
            return;
        }
        let masked = mask_secrets_in_text(chunk, &self.mask_values);
        self.buffer.push_str(&masked);
        if self.buffer.len() >= FLUSH_BYTES || self.last_flush.elapsed() >= FLUSH_INTERVAL {
            self.flush().await;
        }
    }

    pub async fn flush(&mut self) {
        if self.buffer.is_empty() {
            return;
        }
        let chunk = std::mem::take(&mut self.buffer);
        if let Err(err) = self.api.append_log(self.job_id, &chunk).await {
            tracing::warn!(%err, "failed to append live log chunk");
        }
        self.last_flush = Instant::now();
    }
}
