use serde::{Deserialize, Deserializer, Serialize};

use crate::pattern::{glob_match, matches_any_pattern};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct RunContext {
    pub event_type: String,
    pub branch: Option<String>,
    pub tag: Option<String>,
}

impl RunContext {
    pub fn from_trigger(event_type: &str, ref_name: &str) -> Self {
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
        Self {
            event_type: event_type.to_string(),
            branch,
            tag,
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
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum IfStringList {
    One(String),
    Many(Vec<String>),
}

impl IfStringList {
    fn patterns(&self) -> Vec<&str> {
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

impl JobIfMatcher {
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

        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx(event_type: &str, branch: Option<&str>, tag: Option<&str>) -> RunContext {
        RunContext {
            event_type: event_type.to_string(),
            branch: branch.map(str::to_string),
            tag: tag.map(str::to_string),
        }
    }

    #[test]
    fn parses_branch_shorthand() {
        let condition = parse_if_expression("branch == main").unwrap();
        assert!(JobIfMatcher::matches(
            Some(&condition),
            &ctx("push", Some("main"), None)
        ));
        assert!(!JobIfMatcher::matches(
            Some(&condition),
            &ctx("push", Some("qa"), None)
        ));
    }

    #[test]
    fn parses_branch_or_expression() {
        let condition = parse_if_expression("branch == qa || branch == uat").unwrap();
        assert!(JobIfMatcher::matches(
            Some(&condition),
            &ctx("manual", Some("qa"), None)
        ));
        assert!(JobIfMatcher::matches(
            Some(&condition),
            &ctx("manual", Some("uat"), None)
        ));
        assert!(!JobIfMatcher::matches(
            Some(&condition),
            &ctx("manual", Some("main"), None)
        ));
    }

    #[test]
    fn structured_tag_pattern() {
        let condition: JobIfCondition = serde_yaml::from_str("tag: release/*").unwrap();
        assert!(JobIfMatcher::matches(
            Some(&condition),
            &ctx("push", None, Some("release/1.0.0"))
        ));
        assert!(!JobIfMatcher::matches(
            Some(&condition),
            &ctx("push", Some("main"), None)
        ));
    }

    #[test]
    fn manual_event_only() {
        let condition: JobIfCondition = serde_yaml::from_str("event: manual").unwrap();
        assert!(JobIfMatcher::matches(
            Some(&condition),
            &ctx("manual", Some("qa"), None)
        ));
        assert!(!JobIfMatcher::matches(
            Some(&condition),
            &ctx("push", Some("qa"), None)
        ));
    }
}
