use crate::config::{PipelineConfig, PullRequestTrigger, PushTrigger};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PipelineEvent {
    Push {
        branch: String,
        tag: Option<String>,
    },
    PullRequest {
        target_branch: String,
    },
}

pub struct TriggerMatcher;

impl TriggerMatcher {
    pub fn matches(config: &PipelineConfig, event: &PipelineEvent) -> bool {
        match event {
            PipelineEvent::Push { branch, tag } => {
                if let Some(push) = &config.on.push {
                    return Self::matches_push(push, branch, tag.as_deref());
                }
                false
            }
            PipelineEvent::PullRequest { target_branch } => {
                if let Some(pr) = &config.on.pull_request {
                    return Self::matches_pull_request(pr, target_branch);
                }
                false
            }
        }
    }

    fn matches_push(trigger: &PushTrigger, branch: &str, tag: Option<&str>) -> bool {
        if let Some(tag_name) = tag {
            return Self::matches_patterns(trigger.tags.as_deref(), tag_name);
        }
        Self::matches_patterns(trigger.branches.as_deref(), branch)
    }

    fn matches_pull_request(trigger: &PullRequestTrigger, target_branch: &str) -> bool {
        Self::matches_patterns(trigger.branches.as_deref(), target_branch)
    }

    fn matches_patterns(patterns: Option<&[String]>, value: &str) -> bool {
        match patterns {
            None => true,
            Some(list) if list.is_empty() => true,
            Some(list) => list.iter().any(|pattern| glob_match(pattern, value)),
        }
    }
}

fn glob_match(pattern: &str, value: &str) -> bool {
    if pattern == "*" {
        return true;
    }
    if let Some(suffix) = pattern.strip_prefix('*') {
        return value.ends_with(suffix);
    }
    if let Some(prefix) = pattern.strip_suffix('*') {
        return value.starts_with(prefix);
    }
    pattern == value
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;
    use crate::config::{Job, Step, Triggers};

    fn sample_config() -> PipelineConfig {
        PipelineConfig {
            on: Triggers {
                push: Some(PushTrigger {
                    branches: Some(vec!["main".into(), "release/*".into()]),
                    tags: None,
                }),
                pull_request: Some(PullRequestTrigger {
                    branches: Some(vec!["main".into()]),
                }),
            },
            jobs: HashMap::from([(
                "test".into(),
                Job {
                    runs_on: "self-hosted".into(),
                    needs: vec![],
                    required: true,
                    steps: vec![Step {
                        name: None,
                        run: "true".into(),
                        uses: None,
                        working_directory: None,
                        env: HashMap::new(),
                    }],
                    timeout_minutes: None,
                },
            )]),
        }
    }

    #[test]
    fn push_branch_glob() {
        let cfg = sample_config();
        assert!(TriggerMatcher::matches(
            &cfg,
            &PipelineEvent::Push {
                branch: "main".into(),
                tag: None,
            }
        ));
        assert!(TriggerMatcher::matches(
            &cfg,
            &PipelineEvent::Push {
                branch: "release/1.0".into(),
                tag: None,
            }
        ));
        assert!(!TriggerMatcher::matches(
            &cfg,
            &PipelineEvent::Push {
                branch: "dev".into(),
                tag: None,
            }
        ));
    }
}
