pub mod config;
pub mod convert;
pub mod parallel;
pub mod environment;
pub mod predefined;
pub mod secrets;
pub mod executor;
pub mod job_if;
pub mod metrics;
pub mod pattern;
pub mod schedule;
pub mod script;
pub mod trigger;

pub use config::{parse_pipeline_yaml, ArtifactDecl, Job, PipelineConfig, PushTrigger, PullRequestTrigger, Step, Triggers};
pub use job_if::JobIfCondition;
pub use convert::{
    convert_legacy_ci, detect_legacy_ci, CiConvertResult, LegacyCiDetection, LegacyCiKind,
    GITHUB_WORKFLOWS_DIR, GITLAB_CI_PATHS,
};
pub use environment::{
    effective_job_environment, infer_environment_from_ref, normalize_environment, CI_ENVIRONMENTS,
};
pub use predefined::{build_predefined_vars, PredefinedCiContext, PullRequestContext};
pub use executor::{bench_noop_steps, JobExecutor, ShellExecutor, StepOutput};
pub use job_if::{JobIfMatcher, JobScheduleMode, RunContext};
pub use metrics::{JobMetrics, StepTiming};
pub use schedule::{ScheduledJob, Scheduler};
pub use script::render_job_script;
pub use script::{shell_quote, wrap_shell_script_with_env};
pub use secrets::{
    apply_ci_config_to_step, apply_secrets_to_step, mask_secrets_in_text, resolve_secret_refs,
    resolve_var_refs,
};
pub use trigger::{
    matches_pipeline_trigger, pipeline_event_from_ref, trigger_filter_applies, PipelineEvent,
    TriggerMatcher,
};

pub const CONFIG_PATHS: &[&str] = &[
    ".pertisk-ci.yaml",
    ".pertisk-ci.yml",
    "pertisk-ci.yaml",
    "pertisk-ci.yml",
];
