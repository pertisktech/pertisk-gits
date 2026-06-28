use std::collections::HashMap;

use serde::de::Error as DeError;
use serde::{Deserialize, Deserializer, Serialize};
use serde_yaml::Value;

use crate::job_if::{deserialize_job_if, JobIfCondition};

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct PipelineConfig {
    #[serde(default, deserialize_with = "deserialize_triggers")]
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
pub struct ArtifactDecl {
    pub name: String,
    pub path: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct Job {
    #[serde(rename = "runs-on", deserialize_with = "deserialize_runs_on")]
    pub runs_on: String,
    /// Container image for Kubernetes executor (GitLab-style `image:`).
    #[serde(default)]
    pub image: Option<String>,
    /// Deploy environment for this job (dev, qa, uat, prd) — used for secrets and `if: environment`.
    #[serde(default)]
    pub environment: Option<String>,
    /// Spawn a privileged Docker-in-Docker sidecar for job pods (Kubernetes executor).
    #[serde(default)]
    pub dind: bool,
    #[serde(default)]
    pub needs: Vec<String>,
    #[serde(default, deserialize_with = "deserialize_job_if")]
    pub r#if: Option<JobIfCondition>,
    #[serde(default = "default_true")]
    pub required: bool,
    pub steps: Vec<Step>,
    #[serde(default)]
    pub timeout_minutes: Option<u32>,
    #[serde(default)]
    pub artifacts: Vec<ArtifactDecl>,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct Step {
    pub name: Option<String>,
    #[serde(default)]
    pub run: String,
    #[serde(default)]
    pub uses: Option<String>,
    #[serde(rename = "working-directory", default)]
    pub working_directory: Option<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
    #[serde(default)]
    pub with: HashMap<String, String>,
}

#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("invalid pipeline yaml: {0}")]
    Yaml(#[from] serde_yaml::Error),
    #[error("pipeline has no jobs")]
    NoJobs,
}

fn apply_event_name(triggers: &mut Triggers, name: &str) {
    match name {
        "push" => {
            if triggers.push.is_none() {
                triggers.push = Some(PushTrigger {
                    branches: None,
                    tags: None,
                });
            }
        }
        "pull_request" => {
            if triggers.pull_request.is_none() {
                triggers.pull_request = Some(PullRequestTrigger { branches: None });
            }
        }
        _ => {}
    }
}

fn deserialize_triggers<'de, D>(deserializer: D) -> Result<Triggers, D::Error>
where
    D: Deserializer<'de>,
{
    let value = Value::deserialize(deserializer)?;
    match value {
        Value::Null => Ok(Triggers::default()),
        Value::Mapping(_) => serde_yaml::from_value(value).map_err(D::Error::custom),
        Value::String(event) => {
            let mut triggers = Triggers::default();
            apply_event_name(&mut triggers, &event);
            Ok(triggers)
        }
        Value::Sequence(events) => {
            let mut triggers = Triggers::default();
            for event in events {
                let Value::String(name) = event else {
                    return Err(D::Error::custom("on: expected event names"));
                };
                apply_event_name(&mut triggers, &name);
            }
            Ok(triggers)
        }
        other => Err(D::Error::custom(format!("invalid on trigger: {other:?}"))),
    }
}

fn deserialize_runs_on<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: Deserializer<'de>,
{
    let value = Value::deserialize(deserializer)?;
    match value {
        Value::String(label) => Ok(label),
        Value::Sequence(labels) => {
            let joined: Vec<String> = labels
                .into_iter()
                .filter_map(|entry| entry.as_str().map(str::to_string))
                .collect();
            if joined.is_empty() {
                return Err(D::Error::custom("runs-on must be a string or list of strings"));
            }
            Ok(joined.join(","))
        }
        other => Err(D::Error::custom(format!("invalid runs-on: {other:?}"))),
    }
}

fn looks_like_job(value: &Value) -> bool {
    match value {
        Value::Mapping(map) => map.contains_key("runs-on") || map.contains_key("steps"),
        _ => false,
    }
}

fn is_trigger_key(key: &str) -> bool {
    matches!(key, "push" | "pull_request" | "workflow_dispatch" | "schedule")
}

fn normalize_pipeline_value(mut root: serde_yaml::Mapping) -> Result<Value, ConfigError> {
    let mut jobs = match root.remove("jobs") {
        Some(Value::Mapping(map)) => map,
        Some(_) => return Err(ConfigError::Yaml(serde_yaml::Error::custom("jobs must be a map"))),
        None => serde_yaml::Mapping::new(),
    };

    if let Some(on_value) = root.remove("on") {
        match on_value {
            Value::Mapping(on_map) => {
                let mut triggers = serde_yaml::Mapping::new();
                for (key, value) in on_map {
                    let Some(key_str) = key.as_str() else {
                        triggers.insert(key, value);
                        continue;
                    };

                    if is_trigger_key(key_str) {
                        triggers.insert(key, value);
                    } else if looks_like_job(&value) {
                        jobs.insert(key, value);
                    } else {
                        triggers.insert(key, value);
                    }
                }
                root.insert("on".into(), Value::Mapping(triggers));
            }
            other => {
                root.insert("on".into(), other);
            }
        }
    }

    if jobs.is_empty() {
        let stray_keys: Vec<_> = root
            .keys()
            .filter_map(|key| key.as_str().map(str::to_string))
            .filter(|key| !matches!(key.as_str(), "on" | "name" | "env"))
            .collect();

        for key in stray_keys {
            if let Some(value) = root.remove(key.as_str()) {
                if looks_like_job(&value) {
                    jobs.insert(Value::String(key), value);
                } else {
                    root.insert(Value::String(key), value);
                }
            }
        }
    }

    if jobs.is_empty() {
        return Err(ConfigError::Yaml(serde_yaml::Error::custom(
            "missing field `jobs` — add a top-level `jobs:` section for pipeline jobs",
        )));
    }

    root.insert("jobs".into(), Value::Mapping(jobs));
    Ok(Value::Mapping(root))
}

pub fn parse_pipeline_yaml(raw: &str) -> Result<PipelineConfig, ConfigError> {
    let value: Value = serde_yaml::from_str(raw)?;
    let Value::Mapping(root) = value else {
        return Err(ConfigError::Yaml(serde_yaml::Error::custom(
            "pipeline config must be a YAML mapping",
        )));
    };

    let normalized = normalize_pipeline_value(root)?;
    let config: PipelineConfig = serde_yaml::from_value(normalized)?;
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
    runs-on: linux
    steps:
      - name: Build
        run: cargo build --release
      - name: Test
        run: cargo test --workspace

  bench:
    runs-on: linux
    required: false
    needs: [test]
    steps:
      - run: cargo bench --no-run
"#;

    #[test]
    fn parses_job_artifacts() {
        let cfg = parse_pipeline_yaml(
            r#"
on: push
jobs:
  build:
    runs-on: linux
    artifacts:
      - name: binary
        path: target/release/app
    steps:
      - run: cargo build --release
"#,
        )
        .unwrap();
        assert_eq!(cfg.jobs["build"].artifacts.len(), 1);
        assert_eq!(cfg.jobs["build"].artifacts[0].name, "binary");
    }

    #[test]
    fn parses_job_image() {
        let cfg = parse_pipeline_yaml(
            r#"
on: push
jobs:
  build:
    runs-on: kubernetes
    image: rust:1-bookworm
    steps:
      - run: cargo build --release
"#,
        )
        .unwrap();
        assert_eq!(cfg.jobs["build"].image.as_deref(), Some("rust:1-bookworm"));
    }

    #[test]
    fn parses_job_dind() {
        let cfg = parse_pipeline_yaml(
            r#"
on: push
jobs:
  image:
    runs-on: kubernetes
    dind: true
    image: docker:27-cli
    steps:
      - run: docker buildx version
"#,
        )
        .unwrap();
        assert!(cfg.jobs["image"].dind);
        assert_eq!(cfg.jobs["image"].image.as_deref(), Some("docker:27-cli"));
    }

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

    #[test]
    fn parses_on_push_shorthand() {
        let cfg = parse_pipeline_yaml(
            r#"
on: push
jobs:
  test:
    runs-on: linux
    steps:
      - run: echo ok
"#,
        )
        .unwrap();
        assert!(cfg.on.push.is_some());
    }

    #[test]
    fn parses_job_timeout_minutes() {
        let cfg = parse_pipeline_yaml(
            r#"
on: push
jobs:
  build:
    runs-on: linux
    timeout_minutes: 30
    steps:
      - run: sleep 9999
"#,
        )
        .unwrap();
        assert_eq!(cfg.jobs["build"].timeout_minutes, Some(30));
    }

    #[test]
    fn parses_misplaced_job_under_on() {
        let cfg = parse_pipeline_yaml(
            r#"
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

  build-docker:
    runs-on: docker
    steps:
      - run: docker build .
"#,
        )
        .unwrap();
        assert!(cfg.on.push.is_some());
        assert_eq!(cfg.jobs.len(), 1);
        assert_eq!(cfg.jobs["build-docker"].runs_on, "docker");
    }

    #[test]
    fn parses_on_event_list() {
        let cfg = parse_pipeline_yaml(
            r#"
on: [push, pull_request]
jobs:
  test:
    runs-on: [linux, docker]
    steps:
      - uses: actions/checkout@v4
      - run: echo ok
"#,
        )
        .unwrap();
        assert!(cfg.on.push.is_some());
        assert!(cfg.on.pull_request.is_some());
        assert_eq!(cfg.jobs["test"].runs_on, "linux,docker");
        assert_eq!(cfg.jobs["test"].steps[0].uses.as_deref(), Some("actions/checkout@v4"));
    }

    #[test]
    fn parses_job_if_shorthand_and_mapping() {
        let cfg = parse_pipeline_yaml(
            r#"
on: push
jobs:
  deploy-dev:
    runs-on: linux
    if: branch == main
    steps:
      - run: echo dev
  deploy-qa:
    runs-on: linux
    if:
      branch: qa
      event: manual
    steps:
      - run: echo qa
  deploy-prd:
    runs-on: linux
    if:
      tag: release/*
      event: manual
    steps:
      - run: echo prd
"#,
        )
        .unwrap();
        assert!(cfg.jobs["deploy-dev"].r#if.is_some());
        assert!(cfg.jobs["deploy-qa"].r#if.is_some());
        assert!(cfg.jobs["deploy-prd"].r#if.is_some());
    }
}
