use std::time::Duration;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct StepTiming {
    pub name: String,
    pub duration_ms: u64,
    pub exit_code: i32,
    pub started_at: DateTime<Utc>,
    pub finished_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct JobMetrics {
    pub job_name: String,
    pub steps: Vec<StepTiming>,
    pub queue_wait_ms: u64,
    pub execution_ms: u64,
    pub total_ms: u64,
}

impl JobMetrics {
    pub fn from_step_timings(job_name: impl Into<String>, steps: Vec<StepTiming>, queue_wait: Duration) -> Self {
        let execution_ms = steps.iter().map(|s| s.duration_ms).sum();
        let queue_wait_ms = queue_wait.as_millis() as u64;
        Self {
            job_name: job_name.into(),
            steps,
            queue_wait_ms,
            execution_ms,
            total_ms: queue_wait_ms.saturating_add(execution_ms),
        }
    }

    pub fn summary_json(&self) -> String {
        serde_json::to_string(self).unwrap_or_else(|_| "{}".into())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RunnerBenchReport {
    pub iterations: u32,
    pub noop_step_ms_p50: u64,
    pub noop_step_ms_p95: u64,
    pub noop_step_ms_max: u64,
    pub shell_spawn_overhead_ms: u64,
}
