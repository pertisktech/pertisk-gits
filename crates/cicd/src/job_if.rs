use serde::{Deserialize, Deserializer, Serialize};

use crate::pattern::{glob_match, matches_any_pattern};

use crate::environment::infer_environment_from_ref;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct RunContext {
    pub event_type: String,
    pub branch: Option<String>,
    pub tag: Option<String>,
    pub environment: Option<String>,
    /// True when the user picked `environment` on a manual Run pipeline trigger.
    pub environment_explicit: bool,
}

impl RunContext {
    pub fn from_trigger(event_type: &str, ref_name: &str) -> Self {
        Self::from_trigger_with_environment(event_type, ref_name, None, false)
    }

    pub fn from_trigger_with_environment(
        event_type: &str,
        ref_name: &str,
        target_environment: Option<String>,
        environment_explicit: bool,
    ) -> Self {
        let tag = ref_name.strip_prefix("refs/tags/").map(str::to_string);
        let branch = if tag.is_none() {
            Some(
                ref_name
                    .strip_prefix("refs/heads/")
                    .unwrap_or(ref_name)
                    .to_string(),
            )
        } else {
            None
        };
        let environment = target_environment.or_else(|| {
            infer_environment_from_ref(branch.as_deref(), tag.as_deref())
        });
        Self {
            event_type: event_type.to_string(),
            branch,
            tag,
            environment,
            environment_explicit,
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct JobIfCondition {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub branch: Option<IfStringList>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tag: Option<IfTagCondition>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub event: Option<IfStringList>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub environment: Option<IfStringList>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum IfStringList {
    One(String),
    Many(Vec<String>),
}

impl IfStringList {
    pub(crate) fn patterns(&self) -> Vec<&str> {
        match self {
            Self::One(value) => vec![value.as_str()],
            Self::Many(values) => values.iter().map(String::as_str).collect(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum IfTagCondition {
    Any(bool),
    Pattern(String),
    Patterns(Vec<String>),
}

impl IfTagCondition {
    fn patterns(&self) -> Option<Vec<&str>> {
        match self {
            Self::Any(true) => None,
            Self::Any(false) => Some(vec![]),
            Self::Pattern(value) => Some(vec![value.as_str()]),
            Self::Patterns(values) => Some(values.iter().map(String::as_str).collect()),
        }
    }
}

pub fn deserialize_job_if<'de, D>(deserializer: D) -> Result<Option<JobIfCondition>, D::Error>
where
    D: Deserializer<'de>,
{
    let value = Option::<serde_yaml::Value>::deserialize(deserializer)?;
    match value {
        None | Some(serde_yaml::Value::Null) => Ok(None),
        Some(serde_yaml::Value::String(expr)) => parse_if_expression(&expr)
            .map(Some)
            .map_err(serde::de::Error::custom),
        Some(other) => serde_yaml::from_value(other)
            .map(Some)
            .map_err(serde::de::Error::custom),
    }
}

fn parse_if_expression(expr: &str) -> Result<JobIfCondition, String> {
    let trimmed = expr.trim();
    if trimmed.is_empty() {
        return Err("if expression cannot be empty".into());
    }

    if trimmed == "tag" {
        return Ok(JobIfCondition {
            tag: Some(IfTagCondition::Any(true)),
            ..JobIfCondition::default()
        });
    }

    let mut branch = Vec::new();
    let mut tag = Vec::new();
    let mut event = Vec::new();
    let mut environment = Vec::new();

    for part in trimmed.split("||").map(str::trim).filter(|part| !part.is_empty()) {
        if part == "tag" {
            tag.push("*".to_string());
            continue;
        }

        if let Some((lhs, rhs)) = part.split_once("==").map(|(l, r)| (l.trim(), r.trim())) {
            let value = unquote(rhs)?;
            match lhs {
                "branch" => branch.push(value),
                "tag" => tag.push(value),
                "event" => event.push(value),
                "environment" => environment.push(value),
                other => return Err(format!("unsupported if field `{other}`")),
            }
            continue;
        }

        return Err(format!("invalid if clause `{part}`"));
    }

    Ok(JobIfCondition {
        branch: non_empty_list(branch),
        tag: non_empty_tag_list(tag),
        event: non_empty_list(event),
        environment: non_empty_list(environment),
    })
}

fn unquote(value: &str) -> Result<String, String> {
    if (value.starts_with('\'') && value.ends_with('\''))
        || (value.starts_with('"') && value.ends_with('"'))
    {
        if value.len() < 2 {
            return Err(format!("invalid quoted value `{value}`"));
        }
        return Ok(value[1..value.len() - 1].to_string());
    }
    Ok(value.to_string())
}

fn non_empty_list(values: Vec<String>) -> Option<IfStringList> {
    if values.is_empty() {
        None
    } else if values.len() == 1 {
        Some(IfStringList::One(values.into_iter().next().unwrap()))
    } else {
        Some(IfStringList::Many(values))
    }
}

fn non_empty_tag_list(values: Vec<String>) -> Option<IfTagCondition> {
    if values.is_empty() {
        None
    } else if values == ["*"] {
        Some(IfTagCondition::Any(true))
    } else if values.len() == 1 {
        Some(IfTagCondition::Pattern(values.into_iter().next().unwrap()))
    } else {
        Some(IfTagCondition::Patterns(values))
    }
}

pub struct JobIfMatcher;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum JobScheduleMode {
    /// Not part of this pipeline run.
    Skipped,
    /// In the pipeline graph; waiting for the user to click play (GitLab `when: manual`).
    Manual,
    /// Queued to run automatically.
    Queued,
}

impl JobIfMatcher {
    /// How this job should appear in a pipeline run (GitLab-style manual jobs stay visible).
    pub fn schedule_mode(condition: Option<&JobIfCondition>, ctx: &RunContext) -> JobScheduleMode {
        if !Self::matches_without_event(condition, ctx) {
            return JobScheduleMode::Skipped;
        }

        if Self::requires_manual_event(condition) {
            let env_only = condition.is_some_and(|c| {
                c.environment.is_some() && c.branch.is_none() && c.tag.is_none()
            });

            if env_only {
                if ctx.event_type == "manual" {
                    if !ctx.environment_explicit {
                        return JobScheduleMode::Manual;
                    }
                    if Self::matches(condition, ctx) {
                        return JobScheduleMode::Queued;
                    }
                    return JobScheduleMode::Skipped;
                }
                return JobScheduleMode::Manual;
            }

            // branch/tag + event:manual — play button in automatic pipelines only
            if ctx.event_type != "manual" {
                return JobScheduleMode::Manual;
            }
            if Self::is_in_pipeline_manual_play(condition, ctx) {
                return JobScheduleMode::Skipped;
            }
            return JobScheduleMode::Queued;
        }

        if Self::matches(condition, ctx) {
            return JobScheduleMode::Queued;
        }
        JobScheduleMode::Skipped
    }

    /// Jobs like `deploy-qa-manual` (branch main + event: manual): always wait for play.
    fn is_in_pipeline_manual_play(condition: Option<&JobIfCondition>, ctx: &RunContext) -> bool {
        let Some(condition) = condition else {
            return false;
        };
        if let Some(branch) = &condition.branch {
            let Some(branch_name) = ctx.branch.as_deref() else {
                return false;
            };
            return branch
                .patterns()
                .iter()
                .any(|pattern| glob_match(pattern, branch_name) && *pattern == "main");
        }
        false
    }

    pub fn matches_without_event(condition: Option<&JobIfCondition>, ctx: &RunContext) -> bool {
        match condition {
            None => true,
            Some(condition) => {
                let without_event = JobIfCondition {
                    event: None,
                    ..condition.clone()
                };
                let env_only = condition.environment.is_some()
                    && condition.branch.is_none()
                    && condition.tag.is_none();
                if env_only && ctx.event_type == "manual" && !ctx.environment_explicit {
                    let without_env = JobIfCondition {
                        environment: None,
                        ..without_event
                    };
                    return Self::matches_condition(&without_env, ctx);
                }
                Self::matches_condition(&without_event, ctx)
            }
        }
    }

    fn requires_manual_event(condition: Option<&JobIfCondition>) -> bool {
        condition
            .and_then(|c| c.event.as_ref())
            .is_some_and(|event| {
                event
                    .patterns()
                    .iter()
                    .any(|pattern| *pattern == "manual")
            })
    }

    pub fn matches(condition: Option<&JobIfCondition>, ctx: &RunContext) -> bool {
        match condition {
            None => true,
            Some(condition) => Self::matches_condition(condition, ctx),
        }
    }

    fn matches_condition(condition: &JobIfCondition, ctx: &RunContext) -> bool {
        if let Some(branch) = &condition.branch {
            if ctx.tag.is_some() {
                return false;
            }
            let Some(branch_name) = ctx.branch.as_deref() else {
                return false;
            };
            if !branch
                .patterns()
                .iter()
                .any(|pattern| glob_match(pattern, branch_name))
            {
                return false;
            }
        }

        if let Some(tag) = &condition.tag {
            let Some(tag_name) = ctx.tag.as_deref() else {
                return false;
            };
            match tag.patterns() {
                None => {}
                Some(patterns) if patterns.is_empty() => return false,
                Some(patterns) => {
                    if !patterns
                        .iter()
                        .any(|pattern| glob_match(pattern, tag_name))
                    {
                        return false;
                    }
                }
            }
        }

        if let Some(event) = &condition.event {
            let patterns: Vec<String> = match event {
                IfStringList::One(value) => vec![value.clone()],
                IfStringList::Many(values) => values.clone(),
            };
            if !matches_any_pattern(Some(&patterns), &ctx.event_type) {
                return false;
            }
        }

        if let Some(environment) = &condition.environment {
            let Some(env_name) = ctx.environment.as_deref() else {
                return false;
            };
            let patterns: Vec<String> = match environment {
                IfStringList::One(value) => vec![value.clone()],
                IfStringList::Many(values) => values.clone(),
            };
            if !patterns
                .iter()
                .any(|pattern| glob_match(pattern, env_name))
            {
                return false;
            }
        }

        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx(
        event_type: &str,
        branch: Option<&str>,
        tag: Option<&str>,
        environment: Option<&str>,
    ) -> RunContext {
        ctx_with_explicit(event_type, branch, tag, environment, false)
    }

    fn ctx_with_explicit(
        event_type: &str,
        branch: Option<&str>,
        tag: Option<&str>,
        environment: Option<&str>,
        environment_explicit: bool,
    ) -> RunContext {
        RunContext {
            event_type: event_type.to_string(),
            branch: branch.map(str::to_string),
            tag: tag.map(str::to_string),
            environment: environment.map(str::to_string),
            environment_explicit,
        }
    }

    #[test]
    fn parses_branch_shorthand() {
        let condition = parse_if_expression("branch == main").unwrap();
        assert!(JobIfMatcher::matches(
            Some(&condition),
            &ctx("push", Some("main"), None, None)
        ));
        assert!(!JobIfMatcher::matches(
            Some(&condition),
            &ctx("push", Some("qa"), None, None)
        ));
    }

    #[test]
    fn parses_branch_or_expression() {
        let condition = parse_if_expression("branch == qa || branch == uat").unwrap();
        assert!(JobIfMatcher::matches(
            Some(&condition),
            &ctx("manual", Some("qa"), None, None)
        ));
        assert!(JobIfMatcher::matches(
            Some(&condition),
            &ctx("manual", Some("uat"), None, None)
        ));
        assert!(!JobIfMatcher::matches(
            Some(&condition),
            &ctx("manual", Some("main"), None, None)
        ));
    }

    #[test]
    fn structured_tag_pattern() {
        let condition: JobIfCondition = serde_yaml::from_str("tag: release/*").unwrap();
        assert!(JobIfMatcher::matches(
            Some(&condition),
            &ctx("push", None, Some("release/1.0.0"), None)
        ));
        assert!(!JobIfMatcher::matches(
            Some(&condition),
            &ctx("push", Some("main"), None, None)
        ));
    }

    #[test]
    fn manual_event_only() {
        let condition: JobIfCondition = serde_yaml::from_str("event: manual").unwrap();
        assert!(JobIfMatcher::matches(
            Some(&condition),
            &ctx("manual", Some("qa"), None, None)
        ));
        assert!(!JobIfMatcher::matches(
            Some(&condition),
            &ctx("push", Some("main"), None, None)
        ));
        assert_eq!(
            JobIfMatcher::schedule_mode(Some(&condition), &ctx("push", Some("main"), None, None)),
            JobScheduleMode::Manual
        );
        assert_eq!(
            JobIfMatcher::schedule_mode(Some(&condition), &ctx("manual", Some("main"), None, None)),
            JobScheduleMode::Queued
        );
        assert!(!JobIfMatcher::matches(
            Some(&condition),
            &ctx("push", Some("qa"), None, None)
        ));
    }

    #[test]
    fn environment_condition() {
        let condition = parse_if_expression("environment == qa").unwrap();
        assert!(JobIfMatcher::matches(
            Some(&condition),
            &ctx("manual", Some("main"), None, Some("qa"))
        ));
        assert!(!JobIfMatcher::matches(
            Some(&condition),
            &ctx("manual", Some("main"), None, Some("dev"))
        ));
    }

    #[test]
    fn schedule_mode_skipped_when_if_not_met() {
        let condition = parse_if_expression("branch == qa").unwrap();
        assert_eq!(
            JobIfMatcher::schedule_mode(Some(&condition), &ctx("push", Some("main"), None, None)),
            JobScheduleMode::Skipped
        );
    }

    #[test]
    fn structured_branch_list_and_event_combo() {
        let condition: JobIfCondition = serde_yaml::from_str(
            r#"
branch: [qa, uat]
event: manual
"#,
        )
        .unwrap();
        assert!(JobIfMatcher::matches(
            Some(&condition),
            &ctx("manual", Some("uat"), None, None)
        ));
        assert!(!JobIfMatcher::matches(
            Some(&condition),
            &ctx("manual", Some("main"), None, None)
        ));
    }

    #[test]
    fn invalid_if_expression_returns_error() {
        assert!(parse_if_expression("").is_err());
    }

    #[test]
    fn parses_tag_shorthand_expression() {
        let condition = parse_if_expression("tag").unwrap();
        assert!(JobIfMatcher::matches(
            Some(&condition),
            &ctx("push", None, Some("v1.0.0"), None)
        ));
    }

    #[test]
    fn parses_quoted_branch_values() {
        let condition = parse_if_expression("branch == 'release/1.0'").unwrap();
        assert!(JobIfMatcher::matches(
            Some(&condition),
            &ctx("push", Some("release/1.0"), None, None)
        ));
    }

    #[test]
    fn structured_event_and_environment_together() {
        let condition: JobIfCondition = serde_yaml::from_str(
            r#"
event: manual
environment: qa
"#,
        )
        .unwrap();
        assert!(JobIfMatcher::matches(
            Some(&condition),
            &ctx("manual", Some("main"), None, Some("qa"))
        ));
        assert!(!JobIfMatcher::matches(
            Some(&condition),
            &ctx("manual", Some("main"), None, Some("dev"))
        ));
    }

    #[test]
    fn structured_many_branches() {
        let condition: JobIfCondition = serde_yaml::from_str(
            r#"
branch:
  - qa
  - uat
"#,
        )
        .unwrap();
        assert!(JobIfMatcher::matches(
            Some(&condition),
            &ctx("push", Some("uat"), None, None)
        ));
    }

    #[test]
    fn tag_patterns_list() {
        let condition: JobIfCondition = serde_yaml::from_str(
            r#"
tag:
  - v*
  - release/*
"#,
        )
        .unwrap();
        assert!(JobIfMatcher::matches(
            Some(&condition),
            &ctx("push", None, Some("v1.2.3"), None)
        ));
        assert!(JobIfMatcher::matches(
            Some(&condition),
            &ctx("push", None, Some("release/1"), None)
        ));
    }
}
