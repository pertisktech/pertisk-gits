use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_yaml::{Mapping, Value};

use crate::config::{Job, PipelineConfig, PullRequestTrigger, PushTrigger, Step, Triggers};
use crate::job_if::{IfStringList, IfTagCondition, JobIfCondition};

pub const GITLAB_CI_PATHS: &[&str] = &[".gitlab-ci.yml", ".gitlab-ci.yaml"];
pub const GITHUB_WORKFLOWS_DIR: &str = ".github/workflows";

const GITLAB_RESERVED: &[&str] = &[
    "stages",
    "variables",
    "default",
    "include",
    "workflow",
    "image",
    "services",
    "before_script",
    "after_script",
    "cache",
    "pages",
    "retry",
    "spec",
    "component",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LegacyCiKind {
    Gitlab,
    GithubActions,
}

#[derive(Debug, Clone, Serialize)]
pub struct LegacyCiDetection {
    pub kind: LegacyCiKind,
    pub path: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct CiConvertResult {
    pub source_path: String,
    pub source_kind: LegacyCiKind,
    pub converted_yaml: String,
    pub warnings: Vec<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum ConvertError {
    #[error("invalid YAML: {0}")]
    Yaml(String),
    #[error("no convertible jobs found")]
    NoJobs,
}

/// Detect legacy CI config files from repository root tree entry names.
pub fn detect_legacy_ci(root_entries: &[&str], workflow_files: &[&str]) -> Vec<LegacyCiDetection> {
    let mut found = Vec::new();

    for path in GITLAB_CI_PATHS {
        if root_entries.iter().any(|name| name == path) {
            found.push(LegacyCiDetection {
                kind: LegacyCiKind::Gitlab,
                path: (*path).to_string(),
            });
            break;
        }
    }

    for name in workflow_files {
        let lower = name.to_ascii_lowercase();
        if lower.ends_with(".yml") || lower.ends_with(".yaml") {
            found.push(LegacyCiDetection {
                kind: LegacyCiKind::GithubActions,
                path: format!("{GITHUB_WORKFLOWS_DIR}/{name}"),
            });
        }
    }

    found
}

pub fn convert_legacy_ci(kind: LegacyCiKind, source_path: &str, raw: &str) -> Result<CiConvertResult, ConvertError> {
    let (config, warnings) = match kind {
        LegacyCiKind::Gitlab => convert_gitlab_ci(raw)?,
        LegacyCiKind::GithubActions => convert_github_actions(raw)?,
    };

    let converted_yaml = serde_yaml::to_string(&config)
        .map_err(|err| ConvertError::Yaml(err.to_string()))?;

    Ok(CiConvertResult {
        source_path: source_path.to_string(),
        source_kind: kind,
        converted_yaml,
        warnings,
    })
}

fn convert_gitlab_ci(raw: &str) -> Result<(PipelineConfig, Vec<String>), ConvertError> {
    let root: Value = serde_yaml::from_str(raw).map_err(|err| ConvertError::Yaml(err.to_string()))?;
    let map = root
        .as_mapping()
        .ok_or_else(|| ConvertError::Yaml("GitLab CI config must be a mapping".into()))?;

    let mut warnings = vec![
        "Converted from GitLab CI — review triggers (`only`/`rules`) and runner labels.".into(),
    ];

    let stages: Vec<String> = map
        .get("stages")
        .and_then(|value| value.as_sequence())
        .map(|seq| {
            seq.iter()
                .filter_map(|entry| entry.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();

    let mut jobs = HashMap::new();
    let mut stage_jobs: HashMap<String, Vec<String>> = HashMap::new();

    for (key, value) in map {
        let Some(name) = key.as_str() else {
            continue;
        };
        if GITLAB_RESERVED.contains(&name) {
            continue;
        }
        let Some(job_map) = value.as_mapping() else {
            continue;
        };

        let stage = job_map
            .get("stage")
            .and_then(|v| v.as_str())
            .unwrap_or("test")
            .to_string();

        let mut job_warnings = Vec::new();
        let pertisk_job = gitlab_job_to_pertisk(name, job_map, &mut job_warnings)?;
        if pertisk_job.steps.is_empty() {
            warnings.push(format!("job '{name}' has no script steps — omitted"));
            continue;
        }

        jobs.insert(name.to_string(), pertisk_job);
        stage_jobs.entry(stage).or_default().push(name.to_string());
        warnings.extend(job_warnings);
    }

    if jobs.is_empty() {
        return Err(ConvertError::NoJobs);
    }

    apply_gitlab_stage_needs(&mut jobs, &stages, &stage_jobs);

    Ok((
        PipelineConfig {
            on: Triggers {
                push: Some(PushTrigger {
                    branches: None,
                    tags: None,
                }),
                pull_request: None,
            },
            jobs,
        },
        warnings,
    ))
}

fn gitlab_job_to_pertisk(
    _name: &str,
    job: &Mapping,
    mut warnings: &mut Vec<String>,
) -> Result<Job, ConvertError> {
    let mut steps = Vec::new();

    if let Some(before) = job.get("before_script") {
        steps.extend(script_to_steps(before, Some("before_script")));
    }

    if let Some(script) = job.get("script") {
        steps.extend(script_to_steps(script, None));
    }

    if let Some(after) = job.get("after_script") {
        steps.extend(script_to_steps(after, Some("after_script")));
    }

    if job.contains_key("rules") {
        warnings.push("GitLab `rules` are not converted — rewrite as Pertisk `if:`.".into());
    }

    if job.contains_key("except") {
        warnings.push("GitLab `except` is not converted — use Pertisk `if:` with branch/tag patterns.".into());
    }

    if job.contains_key("parallel") || job.contains_key("trigger") {
        warnings.push("GitLab `parallel`/`trigger` jobs are not converted.".into());
    }

    let job_if = gitlab_if_from_job(job, &mut warnings);

    let runs_on = job
        .get("tags")
        .map(|tags| tags_to_runs_on(tags))
        .unwrap_or_else(|| "linux".into());

    let image = scalar_string(job.get("image"));

    let needs = string_list(job.get("needs"));

    let required = !job
        .get("allow_failure")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let timeout_minutes = job
        .get("timeout")
        .and_then(|v| v.as_str())
        .and_then(parse_gitlab_timeout);

    let mut artifacts = Vec::new();
    if let Some(artifact_map) = job.get("artifacts").and_then(|v| v.as_mapping()) {
        if let Some(paths) = artifact_map.get("paths").and_then(|v| v.as_sequence()) {
            for (index, path) in paths.iter().filter_map(|p| p.as_str()).enumerate() {
                artifacts.push(crate::config::ArtifactDecl {
                    name: format!("artifact-{}", index + 1),
                    path: path.to_string(),
                });
            }
        }
    }

    Ok(Job {
        runs_on,
        image,
        environment: None,
        dind: false,
        needs,
        r#if: job_if,
        required,
        steps,
        timeout_minutes,
        artifacts,
    })
}

fn gitlab_if_from_job(job: &Mapping, warnings: &mut Vec<String>) -> Option<JobIfCondition> {
    let mut condition = JobIfCondition::default();

    if let Some(when) = job.get("when").and_then(|v| v.as_str()) {
        match when {
            "manual" => condition.event = Some(IfStringList::One("manual".into())),
            "on_success" | "always" | "on_failure" | "delayed" => {}
            other => warnings.push(format!("GitLab when: {other} — not mapped (treated as default run)")),
        }
    }

    if let Some(only) = job.get("only") {
        apply_gitlab_only(only, &mut condition, warnings);
    }

    if condition == JobIfCondition::default() {
        None
    } else {
        Some(condition)
    }
}

fn apply_gitlab_only(value: &Value, condition: &mut JobIfCondition, warnings: &mut Vec<String>) {
    match value {
        Value::Sequence(items) => {
            let mut branches = Vec::new();
            let mut tags = false;
            for item in items {
                match item {
                    Value::String(entry) => match entry.as_str() {
                        "branches" => {}
                        "tags" => tags = true,
                        branch => branches.push(branch.to_string()),
                    },
                    _ => warnings.push("unsupported GitLab `only` list entry — skipped".into()),
                }
            }
            if !branches.is_empty() {
                condition.branch = Some(if branches.len() == 1 {
                    IfStringList::One(branches.into_iter().next().unwrap())
                } else {
                    IfStringList::Many(branches)
                });
            }
            if tags {
                condition.tag = Some(IfTagCondition::Any(true));
            }
        }
        Value::Mapping(map) => {
            if let Some(refs) = map.get("refs") {
                apply_gitlab_only(refs, condition, warnings);
            }
            if map.contains_key("variables") || map.contains_key("kubernetes") {
                warnings.push("GitLab `only.variables` / `only.kubernetes` not converted.".into());
            }
        }
        Value::String(entry) => apply_gitlab_only(&Value::String(entry.clone()), condition, warnings),
        _ => warnings.push("GitLab `only` format not recognized.".into()),
    }
}

fn apply_gitlab_stage_needs(
    jobs: &mut HashMap<String, Job>,
    stages: &[String],
    stage_jobs: &HashMap<String, Vec<String>>,
) {
    let ordered_stages: Vec<&String> = if stages.is_empty() {
        stage_jobs.keys().collect()
    } else {
        stages.iter().collect()
    };

    for window in ordered_stages.windows(2) {
        let prev_stage = window[0];
        let curr_stage = window[1];
        let Some(prev_jobs) = stage_jobs.get(prev_stage.as_str()) else {
            continue;
        };
        let Some(curr_jobs) = stage_jobs.get(curr_stage.as_str()) else {
            continue;
        };

        for job_name in curr_jobs {
            let Some(job) = jobs.get_mut(job_name) else {
                continue;
            };
            if job.needs.is_empty() {
                job.needs = prev_jobs.clone();
            }
        }
    }
}

fn convert_github_actions(raw: &str) -> Result<(PipelineConfig, Vec<String>), ConvertError> {
    let root: Value = serde_yaml::from_str(raw).map_err(|err| ConvertError::Yaml(err.to_string()))?;
    let map = root
        .as_mapping()
        .ok_or_else(|| ConvertError::Yaml("GitHub workflow must be a mapping".into()))?;

    let mut warnings = vec![
        "Converted from GitHub Actions — review `runs-on` labels and action steps.".into(),
    ];

    if map.contains_key("strategy") {
        warnings.push("GitHub `strategy.matrix` is not converted — duplicate jobs manually if needed.".into());
    }

    let on = parse_github_triggers(map.get("on"));

    let jobs_value = map
        .get("jobs")
        .and_then(|v| v.as_mapping())
        .ok_or(ConvertError::NoJobs)?;

    let mut jobs = HashMap::new();

    for (key, value) in jobs_value {
        let Some(name) = key.as_str() else {
            continue;
        };
        let Some(job_map) = value.as_mapping() else {
            continue;
        };

        let runs_on = job_map
            .get("runs-on")
            .map(|v| map_github_runs_on(v))
            .unwrap_or_else(|| "linux".into());

        if job_map.contains_key("strategy") {
            warnings.push(format!("job '{name}' uses matrix strategy — not converted."));
        }

        let needs = string_list(job_map.get("needs"));

        let timeout_minutes = job_map
            .get("timeout-minutes")
            .and_then(|v| v.as_u64())
            .map(|v| v as u32);

        let mut steps = Vec::new();
        if let Some(step_list) = job_map.get("steps").and_then(|v| v.as_sequence()) {
            for (index, step) in step_list.iter().enumerate() {
                let Some(step_map) = step.as_mapping() else {
                    continue;
                };
                if let Some(converted) = github_step_to_pertisk(step_map, index, &mut warnings) {
                    steps.push(converted);
                }
            }
        }

        if steps.is_empty() {
            warnings.push(format!("job '{name}' has no runnable steps — omitted"));
            continue;
        }

        jobs.insert(
            name.to_string(),
            Job {
                runs_on,
                image: None,
                environment: None,
                dind: false,
                needs,
                r#if: None,
                required: true,
                steps,
                timeout_minutes,
                artifacts: Vec::new(),
            },
        );
    }

    if jobs.is_empty() {
        return Err(ConvertError::NoJobs);
    }

    Ok((PipelineConfig { on, jobs }, warnings))
}

fn github_step_to_pertisk(step: &Mapping, index: usize, warnings: &mut Vec<String>) -> Option<Step> {
    if let Some(uses) = step.get("uses").and_then(|v| v.as_str()) {
        if is_checkout_action(uses) {
            warnings.push(format!(
                "removed `{uses}` — Pertisk runners check out the repository automatically"
            ));
            return None;
        }
    }

    let name = step
        .get("name")
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .or_else(|| step.get("uses").and_then(|v| v.as_str()).map(str::to_string))
        .or_else(|| step.get("run").and_then(|v| v.as_str()).map(|run| truncate(run, 48)));

    let run = step.get("run").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let uses = step.get("uses").and_then(|v| v.as_str()).map(str::to_string);

    if run.trim().is_empty() && uses.is_none() {
        warnings.push(format!("skipped empty step #{}", index + 1));
        return None;
    }

    if uses.is_some() && run.trim().is_empty() {
        warnings.push(format!(
            "step `{}` uses a GitHub Action — replace with shell commands or a custom runner image",
            uses.as_deref().unwrap_or("action")
        ));
    }

    Some(Step {
        name: name.or_else(|| Some(format!("step-{}", index + 1))),
        run,
        uses,
        working_directory: step
            .get("working-directory")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        env: string_map(step.get("env")),
        with: string_map(step.get("with")),
    })
}

fn parse_github_triggers(on_value: Option<&Value>) -> Triggers {
    let mut triggers = Triggers::default();

    let apply_event = |triggers: &mut Triggers, name: &str, detail: Option<&Value>| {
        match name {
            "push" => {
                triggers.push = Some(parse_push_trigger(detail));
            }
            "pull_request" => {
                triggers.pull_request = Some(parse_pull_request_trigger(detail));
            }
            "workflow_dispatch" | "schedule" => {}
            _ => {}
        }
    };

    match on_value {
        None => {
            triggers.push = Some(PushTrigger {
                branches: None,
                tags: None,
            });
        }
        Some(Value::String(event)) => apply_event(&mut triggers, event, None),
        Some(Value::Sequence(events)) => {
            for event in events {
                if let Some(name) = event.as_str() {
                    apply_event(&mut triggers, name, None);
                }
            }
        }
        Some(Value::Mapping(map)) => {
            for (key, value) in map {
                if let Some(name) = key.as_str() {
                    apply_event(&mut triggers, name, Some(value));
                }
            }
        }
        _ => {}
    }

    if triggers.push.is_none() && triggers.pull_request.is_none() {
        triggers.push = Some(PushTrigger {
            branches: None,
            tags: None,
        });
    }

    triggers
}

fn parse_push_trigger(detail: Option<&Value>) -> PushTrigger {
    let branches = detail
        .and_then(|v| v.get("branches"))
        .map(|v| string_list(Some(v)))
        .filter(|list| !list.is_empty());
    let tags = detail
        .and_then(|v| v.get("tags"))
        .map(|v| string_list(Some(v)))
        .filter(|list| !list.is_empty());

    PushTrigger { branches, tags }
}

fn parse_pull_request_trigger(detail: Option<&Value>) -> PullRequestTrigger {
    let branches = detail
        .and_then(|v| v.get("branches"))
        .map(|v| string_list(Some(v)))
        .filter(|list| !list.is_empty());

    PullRequestTrigger { branches }
}

fn script_to_steps(value: &Value, prefix: Option<&str>) -> Vec<Step> {
    match value {
        Value::String(cmd) => vec![Step {
            name: prefix.map(|p| p.to_string()),
            run: cmd.clone(),
            uses: None,
            working_directory: None,
            env: HashMap::new(),
            with: HashMap::new(),
        }],
        Value::Sequence(items) => items
            .iter()
            .enumerate()
            .filter_map(|(index, item)| {
                item.as_str().map(|cmd| Step {
                    name: prefix.map(|p| format!("{p}-{}", index + 1)),
                    run: cmd.to_string(),
                    uses: None,
                    working_directory: None,
                    env: HashMap::new(),
                    with: HashMap::new(),
                })
            })
            .collect(),
        _ => Vec::new(),
    }
}

fn tags_to_runs_on(tags: &Value) -> String {
    match tags {
        Value::String(tag) => tag.clone(),
        Value::Sequence(seq) => seq
            .iter()
            .filter_map(|v| v.as_str())
            .collect::<Vec<_>>()
            .join(","),
        _ => "linux".into(),
    }
}

fn map_github_runs_on(value: &Value) -> String {
    match value {
        Value::String(label) => map_github_label(label),
        Value::Sequence(labels) => labels
            .iter()
            .filter_map(|v| v.as_str().map(map_github_label))
            .collect::<Vec<_>>()
            .join(","),
        _ => "linux".into(),
    }
}

fn map_github_label(label: &str) -> String {
    let lower = label.to_ascii_lowercase();
    if lower.contains("docker") {
        "docker".into()
    } else if lower.contains("kubernetes") || lower.contains("k8s") {
        "kubernetes".into()
    } else if lower.starts_with("ubuntu") || lower.starts_with("linux") || lower.contains("windows") {
        "linux".into()
    } else {
        label.to_string()
    }
}

fn is_checkout_action(uses: &str) -> bool {
    uses.starts_with("actions/checkout")
}

fn string_list(value: Option<&Value>) -> Vec<String> {
    match value {
        Some(Value::String(item)) => vec![item.clone()],
        Some(Value::Sequence(items)) => items
            .iter()
            .filter_map(|entry| match entry {
                Value::String(s) => Some(s.clone()),
                Value::Mapping(map) => map
                    .get("job")
                    .and_then(|v| v.as_str())
                    .map(str::to_string),
                _ => None,
            })
            .collect(),
        _ => Vec::new(),
    }
}

fn string_map(value: Option<&Value>) -> HashMap<String, String> {
    let Some(map) = value.and_then(|v| v.as_mapping()) else {
        return HashMap::new();
    };

    map.iter()
        .filter_map(|(key, val)| {
            let key = key.as_str()?.to_string();
            let val = scalar_string(Some(val))?;
            Some((key, val))
        })
        .collect()
}

fn scalar_string(value: Option<&Value>) -> Option<String> {
    match value {
        Some(Value::String(s)) => Some(s.clone()),
        Some(Value::Number(n)) => Some(n.to_string()),
        Some(Value::Bool(b)) => Some(b.to_string()),
        Some(Value::Mapping(map)) => map.get("name").and_then(|v| v.as_str()).map(str::to_string),
        _ => None,
    }
}

fn parse_gitlab_timeout(raw: &str) -> Option<u32> {
    if raw.ends_with(" minutes") {
        return raw.trim_end_matches(" minutes").parse().ok();
    }
    if raw.ends_with(" hours") {
        return raw
            .trim_end_matches(" hours")
            .parse::<u32>()
            .ok()
            .map(|hours| hours.saturating_mul(60));
    }
    raw.parse().ok()
}

fn truncate(text: &str, max: usize) -> String {
    if text.len() <= max {
        return text.to_string();
    }
    format!("{}…", &text[..max.saturating_sub(1)])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_gitlab_and_github_files() {
        let found = detect_legacy_ci(
            &["README.md", ".gitlab-ci.yml"],
            &["ci.yaml", "release.yml", "README.md"],
        );
        assert_eq!(found.len(), 3);
        assert!(found.iter().any(|d| d.kind == LegacyCiKind::Gitlab));
        assert_eq!(
            found
                .iter()
                .filter(|d| d.kind == LegacyCiKind::GithubActions)
                .count(),
            2
        );
    }

    #[test]
    fn converts_gitlab_only_when_manual() {
        let raw = r#"
build_feature:
  script: npm run build
  only:
    - feature/*
  when: manual
"#;
        let result = convert_legacy_ci(LegacyCiKind::Gitlab, ".gitlab-ci.yml", raw).unwrap();
        assert!(result.converted_yaml.contains("branch: feature/*"));
        assert!(result.converted_yaml.contains("event: manual"));
    }

    #[test]
    fn converts_gitlab_ci() {
        let raw = r#"
stages:
  - build
  - test

build:
  stage: build
  tags: [docker]
  script:
    - npm ci
    - npm run build

test:
  stage: test
  script: npm test
"#;
        let result = convert_legacy_ci(LegacyCiKind::Gitlab, ".gitlab-ci.yml", raw).unwrap();
        assert!(result.converted_yaml.contains("runs-on: docker"));
        assert!(result.converted_yaml.contains("npm ci"));
        assert!(result.converted_yaml.contains("needs:"));
    }

    #[test]
    fn converts_github_actions() {
        let raw = r#"
on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm test
"#;
        let result =
            convert_legacy_ci(LegacyCiKind::GithubActions, ".github/workflows/ci.yml", raw).unwrap();
        assert!(!result.converted_yaml.contains("actions/checkout"));
        assert!(result.converted_yaml.contains("runs-on: linux"));
        assert!(result.converted_yaml.contains("npm test"));
        assert!(result.warnings.iter().any(|w| w.contains("checkout")));
    }
}
