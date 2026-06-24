pub mod config;
pub mod executor;
pub mod metrics;
pub mod schedule;
pub mod trigger;

pub use config::{parse_pipeline_yaml, Job, PipelineConfig, Step};
pub use executor::{bench_noop_steps, JobExecutor, ShellExecutor, StepOutput};
pub use metrics::{JobMetrics, StepTiming};
pub use schedule::{ScheduledJob, Scheduler};
pub use trigger::{PipelineEvent, TriggerMatcher};

pub const CONFIG_PATHS: &[&str] = &[
    ".pertisk-ci.yaml",
    ".pertisk-ci.yml",
    "pertisk-ci.yaml",
    "pertisk-ci.yml",
];
