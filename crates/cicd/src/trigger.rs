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
            if Self::matches_patterns(trigger.tags.as_deref(), tag_name) {
                return true;
            }
            return Self::matches_patterns(trigger.branches.as_deref(), tag_name);
        }
        Self::matches_patterns(trigger.branches.as_deref(), branch)
    }

    fn matches_pull_request(trigger: &PullRequestTrigger, target_branch: &str) -> bool {
        Self::matches_patterns(trigger.branches.as_deref(), target_branch)
    }

    fn matches_patterns(patterns: Option<&[String]>, value: &str) -> bool {
        crate::pattern::matches_any_pattern(patterns, value)
    }
}

/// Whether `on.push` / `on.pull_request` branch filters apply to this event.
/// Manual runs are user-initiated; job `if:` conditions select which jobs run.
pub fn trigger_filter_applies(event_type: &str) -> bool {
    event_type != "manual"
}

/// Match automatic triggers (`push`, `pull_request`). Manual events always match.
pub fn matches_pipeline_trigger(
    config: &PipelineConfig,
    event_type: &str,
    ref_name: &str,
) -> bool {
    if !trigger_filter_applies(event_type) {
        return true;
    }
    let event = pipeline_event_from_ref(event_type, ref_name);
    TriggerMatcher::matches(config, &event)
}

/// Build a push/pull_request event from a git ref and event type.
pub fn pipeline_event_from_ref(event_type: &str, ref_name: &str) -> PipelineEvent {
    match event_type {
        "pull_request" => PipelineEvent::PullRequest {
            target_branch: ref_name.strip_prefix("refs/heads/").unwrap_or(ref_name).into(),
        },
        _ => {
            if let Some(tag) = ref_name.strip_prefix("refs/tags/") {
                PipelineEvent::Push {
                    branch: String::new(),
                    tag: Some(tag.to_string()),
                }
            } else {
                PipelineEvent::Push {
                    branch: ref_name
                        .strip_prefix("refs/heads/")
                        .unwrap_or(ref_name)
                        .to_string(),
                    tag: None,
                }
            }
        }
    }
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
                    runs_on: "linux".into(),
                    image: None,
                    dind: false,
                    needs: vec![],
                    r#if: None,
                    required: true,
                    steps: vec![Step {
                        name: None,
                        run: "true".into(),
                        uses: None,
                        working_directory: None,
                        env: HashMap::new(),
                        with: HashMap::new(),
                    }],
                    timeout_minutes: None,
                    artifacts: vec![],
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

    #[test]
    fn push_qa_uat_branches() {
        let cfg = sample_config_with_branches(&["main", "qa", "uat"]);
        assert!(TriggerMatcher::matches(
            &cfg,
            &PipelineEvent::Push {
                branch: "qa".into(),
                tag: None,
            }
        ));
        assert!(TriggerMatcher::matches(
            &cfg,
            &PipelineEvent::Push {
                branch: "uat".into(),
                tag: None,
            }
        ));
    }

    #[test]
    fn push_tag_matches_tags_or_branch_glob() {
        let cfg = PipelineConfig {
            on: Triggers {
                push: Some(PushTrigger {
                    branches: Some(vec!["release/*".into()]),
                    tags: Some(vec!["v*".into()]),
                }),
                pull_request: None,
            },
            jobs: HashMap::new(),
        };
        assert!(TriggerMatcher::matches(
            &cfg,
            &PipelineEvent::Push {
                branch: String::new(),
                tag: Some("v1.2".into()),
            }
        ));
        assert!(TriggerMatcher::matches(
            &cfg,
            &PipelineEvent::Push {
                branch: String::new(),
                tag: Some("release/1.0".into()),
            }
        ));
        assert!(!TriggerMatcher::matches(
            &cfg,
            &PipelineEvent::Push {
                branch: String::new(),
                tag: Some("other".into()),
            }
        ));
    }

    #[test]
    fn manual_bypasses_on_push_branch_filter() {
        let cfg = sample_config();
        assert!(!TriggerMatcher::matches(
            &cfg,
            &PipelineEvent::Push {
                branch: "qa".into(),
                tag: None,
            }
        ));
        assert!(matches_pipeline_trigger(
            &cfg,
            "manual",
            "refs/heads/qa",
        ));
    }

    fn sample_config_with_branches(branches: &[&str]) -> PipelineConfig {
        PipelineConfig {
            on: Triggers {
                push: Some(PushTrigger {
                    branches: Some(branches.iter().map(|b| (*b).to_string()).collect()),
                    tags: None,
                }),
                pull_request: None,
            },
            jobs: HashMap::new(),
        }
    }
}
