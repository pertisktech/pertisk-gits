pub mod config;
pub mod convert;
pub mod secrets;
pub mod executor;
pub mod metrics;
pub mod schedule;
pub mod script;
pub mod trigger;

pub use config::{parse_pipeline_yaml, ArtifactDecl, Job, PipelineConfig, Step};
pub use convert::{
    convert_legacy_ci, detect_legacy_ci, CiConvertResult, LegacyCiDetection, LegacyCiKind,
    GITHUB_WORKFLOWS_DIR, GITLAB_CI_PATHS,
};
pub use executor::{bench_noop_steps, JobExecutor, ShellExecutor, StepOutput};
pub use metrics::{JobMetrics, StepTiming};
pub use schedule::{ScheduledJob, Scheduler};
pub use script::render_job_script;
pub use secrets::{apply_secrets_to_step, mask_secrets_in_text, resolve_secret_refs};
pub use trigger::{PipelineEvent, TriggerMatcher};

pub const CONFIG_PATHS: &[&str] = &[
    ".pertisk-ci.yaml",
    ".pertisk-ci.yml",
    "pertisk-ci.yaml",
    "pertisk-ci.yml",
];
