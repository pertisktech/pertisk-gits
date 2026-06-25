pub mod config;
pub mod secrets;
pub mod executor;
pub mod metrics;
pub mod schedule;
pub mod trigger;

pub use config::{parse_pipeline_yaml, ArtifactDecl, Job, PipelineConfig, Step};
pub use executor::{bench_noop_steps, JobExecutor, ShellExecutor, StepOutput};
pub use metrics::{JobMetrics, StepTiming};
pub use schedule::{ScheduledJob, Scheduler};
pub use secrets::{apply_secrets_to_step, mask_secrets_in_text, resolve_secret_refs};
pub use trigger::{PipelineEvent, TriggerMatcher};

pub const CONFIG_PATHS: &[&str] = &[
    ".pertisk-ci.yaml",
    ".pertisk-ci.yml",
    "pertisk-ci.yaml",
    "pertisk-ci.yml",
];
