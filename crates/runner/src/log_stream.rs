use std::time::{Duration, Instant};

use uuid::Uuid;

use crate::api::RunnerApi;

const FLUSH_INTERVAL: Duration = Duration::from_millis(400);
const FLUSH_BYTES: usize = 2048;

pub struct LogStreamer<'a> {
    api: &'a RunnerApi,
    job_id: Uuid,
    buffer: String,
    last_flush: Instant,
}

impl<'a> LogStreamer<'a> {
    pub fn new(api: &'a RunnerApi, job_id: Uuid) -> Self {
        Self {
            api,
            job_id,
            buffer: String::new(),
            last_flush: Instant::now(),
        }
    }

    pub async fn push(&mut self, chunk: &str) {
        if chunk.is_empty() {
            return;
        }
        self.buffer.push_str(chunk);
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
