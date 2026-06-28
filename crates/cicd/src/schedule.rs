use std::collections::{HashMap, HashSet, VecDeque};

use crate::config::{Job, PipelineConfig};
use crate::job_if::{JobIfMatcher, RunContext};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScheduledJob {
    pub name: String,
    pub job: Job,
    pub skipped: bool,
}

#[derive(Debug, thiserror::Error)]
pub enum ScheduleError {
    #[error("unknown job dependency: {0}")]
    UnknownDependency(String),
    #[error("circular job dependency involving {0}")]
    Cycle(String),
}

pub struct Scheduler;

impl Scheduler {
    /// Topological order of all jobs, marking those skipped by `if:` or unmet needs.
    pub fn schedule_for_run(
        config: &PipelineConfig,
        ctx: &RunContext,
    ) -> Result<Vec<ScheduledJob>, ScheduleError> {
        let ordered = Self::schedule(config)?;
        let mut active: HashSet<String> = ordered
            .iter()
            .filter(|job| JobIfMatcher::matches(job.job.r#if.as_ref(), ctx))
            .map(|job| job.name.clone())
            .collect();

        loop {
            let before = active.len();
            for job in &ordered {
                if !active.contains(&job.name) {
                    continue;
                }
                for need in &job.job.needs {
                    if config.jobs.contains_key(need) && !active.contains(need) {
                        active.remove(&job.name);
                        break;
                    }
                }
            }
            if active.len() == before {
                break;
            }
        }

        Ok(ordered
            .into_iter()
            .map(|job| ScheduledJob {
                skipped: !active.contains(&job.name),
                name: job.name,
                job: job.job,
            })
            .collect())
    }

    /// Topological order of jobs respecting `needs` edges.
    pub fn schedule(config: &PipelineConfig) -> Result<Vec<ScheduledJob>, ScheduleError> {
        let mut indegree: HashMap<&str, usize> = config.jobs.keys().map(|k| (k.as_str(), 0)).collect();
        let mut dependents: HashMap<&str, Vec<&str>> = HashMap::new();

        for (name, job) in &config.jobs {
            for dep in &job.needs {
                if !config.jobs.contains_key(dep) {
                    return Err(ScheduleError::UnknownDependency(dep.clone()));
                }
                *indegree.get_mut(name.as_str()).unwrap() += 1;
                dependents.entry(dep.as_str()).or_default().push(name.as_str());
            }
        }

        let mut queue: VecDeque<&str> = indegree
            .iter()
            .filter_map(|(name, &deg)| if deg == 0 { Some(*name) } else { None })
            .collect();
        queue.make_contiguous().sort_unstable();

        let mut ordered = Vec::new();
        let mut seen = HashSet::new();

        while let Some(name) = queue.pop_front() {
            if !seen.insert(name) {
                return Err(ScheduleError::Cycle(name.to_string()));
            }
            let job = config.jobs.get(name).unwrap().clone();
            ordered.push(ScheduledJob {
                name: name.to_string(),
                job,
                skipped: false,
            });

            if let Some(children) = dependents.get(name) {
                let mut next: Vec<&str> = children.clone();
                next.sort_unstable();
                for child in next {
                    let entry = indegree.get_mut(child).unwrap();
                    *entry -= 1;
                    if *entry == 0 {
                        queue.push_back(child);
                    }
                }
            }
        }

        if ordered.len() != config.jobs.len() {
            let stuck = config
                .jobs
                .keys()
                .find(|name| !seen.contains(name.as_str()))
                .cloned()
                .unwrap_or_else(|| "unknown".into());
            return Err(ScheduleError::Cycle(stuck));
        }

        Ok(ordered)
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;
    use crate::config::{Job, Step, Triggers};

    #[test]
    fn orders_by_needs() {
        let config = PipelineConfig {
            on: Triggers::default(),
            jobs: HashMap::from([
                (
                    "bench".into(),
                    Job {
                        runs_on: "linux".into(),
                        image: None,
                        dind: false,
                        needs: vec!["test".into()],
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
                ),
                (
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
                ),
            ]),
        };

        let jobs = Scheduler::schedule(&config).unwrap();
        assert_eq!(jobs[0].name, "test");
        assert_eq!(jobs[1].name, "bench");
    }

    #[test]
    fn staged_qa_manual_skips_other_env_jobs() {
        use crate::job_if::RunContext;
        use crate::parse_pipeline_yaml;

        let yaml = include_str!("../examples/pertisk-ci-staged.yaml");
        let config = parse_pipeline_yaml(yaml).unwrap();
        let ctx = RunContext {
            event_type: "manual".into(),
            branch: Some("qa".into()),
            tag: None,
        };
        let jobs = Scheduler::schedule_for_run(&config, &ctx).unwrap();

        assert!(jobs.iter().find(|job| job.name == "deploy-dev").unwrap().skipped);
        assert!(jobs.iter().find(|job| job.name == "deploy-uat").unwrap().skipped);
        assert!(!jobs.iter().find(|job| job.name == "deploy-qa").unwrap().skipped);
        assert!(!jobs.iter().find(|job| job.name == "unit-test").unwrap().skipped);
    }

    #[test]
    fn staged_qa_push_skips_manual_deploy() {
        use crate::job_if::RunContext;
        use crate::parse_pipeline_yaml;

        let yaml = include_str!("../examples/pertisk-ci-staged.yaml");
        let config = parse_pipeline_yaml(yaml).unwrap();
        let ctx = RunContext {
            event_type: "push".into(),
            branch: Some("qa".into()),
            tag: None,
        };
        let jobs = Scheduler::schedule_for_run(&config, &ctx).unwrap();

        assert!(jobs.iter().find(|job| job.name == "deploy-dev").unwrap().skipped);
        assert!(jobs.iter().find(|job| job.name == "deploy-qa").unwrap().skipped);
        assert!(!jobs.iter().find(|job| job.name == "unit-test").unwrap().skipped);
    }

    #[test]
    fn skips_jobs_when_if_not_met() {
        use crate::job_if::{JobIfCondition, IfStringList, RunContext};

        let config = PipelineConfig {
            on: Triggers::default(),
            jobs: HashMap::from([
                (
                    "build".into(),
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
                ),
                (
                    "deploy-qa".into(),
                    Job {
                        runs_on: "linux".into(),
                        image: None,
                        dind: false,
                        needs: vec!["build".into()],
                        r#if: Some(JobIfCondition {
                            branch: Some(IfStringList::One("qa".into())),
                            tag: None,
                            event: None,
                        }),
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
                ),
            ]),
        };

        let ctx = RunContext {
            event_type: "push".into(),
            branch: Some("main".into()),
            tag: None,
        };
        let jobs = Scheduler::schedule_for_run(&config, &ctx).unwrap();
        assert!(!jobs.iter().find(|job| job.name == "build").unwrap().skipped);
        assert!(jobs.iter().find(|job| job.name == "deploy-qa").unwrap().skipped);
    }
}
