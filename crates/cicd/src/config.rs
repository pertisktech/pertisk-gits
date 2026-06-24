use std::collections::HashMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct PipelineConfig {
    pub on: Triggers,
    pub jobs: HashMap<String, Job>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default, PartialEq, Eq)]
pub struct Triggers {
    pub push: Option<PushTrigger>,
    #[serde(rename = "pull_request")]
    pub pull_request: Option<PullRequestTrigger>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct PushTrigger {
    pub branches: Option<Vec<String>>,
    pub tags: Option<Vec<String>>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct PullRequestTrigger {
    pub branches: Option<Vec<String>>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct Job {
    #[serde(rename = "runs-on")]
    pub runs_on: String,
    #[serde(default)]
    pub needs: Vec<String>,
    #[serde(default = "default_true")]
    pub required: bool,
    pub steps: Vec<Step>,
    #[serde(default)]
    pub timeout_minutes: Option<u32>,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct Step {
    pub name: Option<String>,
    pub run: String,
    #[serde(rename = "working-directory", default)]
    pub working_directory: Option<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
}

#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("invalid pipeline yaml: {0}")]
    Yaml(#[from] serde_yaml::Error),
    #[error("pipeline has no jobs")]
    NoJobs,
}

pub fn parse_pipeline_yaml(raw: &str) -> Result<PipelineConfig, ConfigError> {
    let config: PipelineConfig = serde_yaml::from_str(raw)?;
    if config.jobs.is_empty() {
        return Err(ConfigError::NoJobs);
    }
    Ok(config)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"
on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: self-hosted
    steps:
      - name: Build
        run: cargo build --release
      - name: Test
        run: cargo test --workspace

  bench:
    runs-on: self-hosted
    required: false
    needs: [test]
    steps:
      - run: cargo bench --no-run
"#;

    #[test]
    fn parses_optional_required_job() {
        let cfg = parse_pipeline_yaml(SAMPLE).unwrap();
        assert!(cfg.jobs["test"].required);
        assert!(!cfg.jobs["bench"].required);
    }

    #[test]
    fn parses_pipeline_config() {
        let cfg = parse_pipeline_yaml(SAMPLE).unwrap();
        assert_eq!(cfg.jobs.len(), 2);
        assert_eq!(cfg.jobs["test"].steps.len(), 2);
        assert_eq!(cfg.jobs["bench"].needs, vec!["test"]);
    }
}
