use std::collections::{HashMap, HashSet, VecDeque};

use crate::config::{Job, PipelineConfig};
use crate::job_if::{JobIfMatcher, JobScheduleMode, RunContext};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScheduledJob {
    pub name: String,
    pub job: Job,
    pub mode: JobScheduleMode,
}

impl ScheduledJob {
    pub fn skipped(&self) -> bool {
        self.mode == JobScheduleMode::Skipped
    }

    pub fn db_status(&self) -> &'static str {
        match self.mode {
            JobScheduleMode::Skipped => "skipped",
            JobScheduleMode::Manual => "manual",
            JobScheduleMode::Queued => "queued",
        }
    }

    pub fn initial_log(&self) -> &'static str {
        match self.mode {
            JobScheduleMode::Skipped => "=== skipped (if condition not met)\n",
            JobScheduleMode::Manual => "=== waiting for manual trigger (click play to run)\n",
            JobScheduleMode::Queued => "",
        }
    }

    pub fn finishes_immediately(&self) -> bool {
        self.mode == JobScheduleMode::Skipped
    }

    pub fn commit_status(&self) -> (&'static str, &'static str) {
        match self.mode {
            JobScheduleMode::Skipped => ("success", "Skipped"),
            JobScheduleMode::Manual => ("pending", "Manual"),
            JobScheduleMode::Queued => ("pending", "Queued"),
        }
    }
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
    /// Topological order of all jobs, marking skipped / manual / queued by `if:` and needs.
    pub fn schedule_for_run(
        config: &PipelineConfig,
        ctx: &RunContext,
    ) -> Result<Vec<ScheduledJob>, ScheduleError> {
        let ordered = Self::schedule(config)?;
        let mut modes: HashMap<String, JobScheduleMode> = ordered
            .iter()
            .map(|job| {
                (
                    job.name.clone(),
                    JobIfMatcher::schedule_mode(job.job.r#if.as_ref(), ctx),
                )
            })
            .collect();

        loop {
            let mut changed = false;
            for job in &ordered {
                if modes.get(&job.name) == Some(&JobScheduleMode::Skipped) {
                    continue;
                }
                for need in &job.job.needs {
                    if modes.get(need) == Some(&JobScheduleMode::Skipped) {
                        modes.insert(job.name.clone(), JobScheduleMode::Skipped);
                        changed = true;
                        break;
                    }
                }
            }
            if !changed {
                break;
            }
        }

        Ok(ordered
            .into_iter()
            .map(|job| ScheduledJob {
                mode: modes
                    .get(&job.name)
                    .copied()
                    .unwrap_or(JobScheduleMode::Skipped),
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
                mode: JobScheduleMode::Queued,
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
    use crate::job_if::{JobIfCondition, IfStringList, RunContext};

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
                        environment: None,
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
                        environment: None,
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
    fn staged_manual_feature_branch_build() {
        use crate::parse_pipeline_yaml;

        let yaml = include_str!("../examples/pertisk-ci-staged.yaml");
        let config = parse_pipeline_yaml(yaml).unwrap();
        let ctx = RunContext::from_trigger("manual", "refs/heads/feature/my-work");
        let jobs = Scheduler::schedule_for_run(&config, &ctx).unwrap();

        assert_eq!(
            jobs.iter().find(|job| job.name == "build-feature").unwrap().mode,
            JobScheduleMode::Queued
        );
        assert_eq!(
            jobs.iter().find(|job| job.name == "test-feature").unwrap().mode,
            JobScheduleMode::Queued
        );
        assert_eq!(
            jobs.iter().find(|job| job.name == "unit-test").unwrap().mode,
            JobScheduleMode::Skipped
        );
        assert_eq!(
            jobs.iter().find(|job| job.name == "deploy-qa").unwrap().mode,
            JobScheduleMode::Skipped
        );
    }

    #[test]
    fn staged_main_push_runs_build_and_dev() {
        use crate::parse_pipeline_yaml;

        let yaml = include_str!("../examples/pertisk-ci-staged.yaml");
        let config = parse_pipeline_yaml(yaml).unwrap();
        let ctx = RunContext::from_trigger("push", "refs/heads/main");
        let jobs = Scheduler::schedule_for_run(&config, &ctx).unwrap();

        assert_eq!(
            jobs.iter().find(|job| job.name == "unit-test").unwrap().mode,
            JobScheduleMode::Queued
        );
        assert_eq!(
            jobs.iter().find(|job| job.name == "deploy-dev").unwrap().mode,
            JobScheduleMode::Queued
        );
        assert_eq!(
            jobs.iter().find(|job| job.name == "deploy-qa").unwrap().mode,
            JobScheduleMode::Skipped
        );
        assert_eq!(
            jobs.iter().find(|job| job.name == "deploy-uat").unwrap().mode,
            JobScheduleMode::Skipped
        );
    }

    #[test]
    fn staged_main_push_shows_manual_play_jobs() {
        use crate::parse_pipeline_yaml;

        let yaml = include_str!("../examples/pertisk-ci-staged.yaml");
        let config = parse_pipeline_yaml(yaml).unwrap();
        let ctx = RunContext::from_trigger("push", "refs/heads/main");
        let jobs = Scheduler::schedule_for_run(&config, &ctx).unwrap();

        assert_eq!(
            jobs.iter().find(|job| job.name == "deploy-qa-manual").unwrap().mode,
            JobScheduleMode::Manual
        );
        assert_eq!(
            jobs.iter().find(|job| job.name == "deploy-uat-manual").unwrap().mode,
            JobScheduleMode::Manual
        );
    }

    #[test]
    fn staged_manual_qa_from_tag() {
        use crate::parse_pipeline_yaml;

        let yaml = include_str!("../examples/pertisk-ci-staged.yaml");
        let config = parse_pipeline_yaml(yaml).unwrap();
        let ctx = RunContext::from_trigger_with_environment(
            "manual",
            "refs/tags/v1.0.0",
            Some("qa".into()),
        );
        let jobs = Scheduler::schedule_for_run(&config, &ctx).unwrap();

        assert_eq!(
            jobs.iter().find(|job| job.name == "unit-test").unwrap().mode,
            JobScheduleMode::Skipped
        );
        assert_eq!(
            jobs.iter().find(|job| job.name == "deploy-qa").unwrap().mode,
            JobScheduleMode::Queued
        );
        assert_eq!(
            jobs.iter().find(|job| job.name == "deploy-uat").unwrap().mode,
            JobScheduleMode::Skipped
        );
    }

    #[test]
    fn staged_manual_uat() {
        use crate::parse_pipeline_yaml;

        let yaml = include_str!("../examples/pertisk-ci-staged.yaml");
        let config = parse_pipeline_yaml(yaml).unwrap();
        let ctx = RunContext::from_trigger_with_environment(
            "manual",
            "refs/heads/main",
            Some("uat".into()),
        );
        let jobs = Scheduler::schedule_for_run(&config, &ctx).unwrap();

        assert_eq!(
            jobs.iter().find(|job| job.name == "unit-test").unwrap().mode,
            JobScheduleMode::Skipped
        );
        assert_eq!(
            jobs.iter().find(|job| job.name == "deploy-qa").unwrap().mode,
            JobScheduleMode::Skipped
        );
        assert_eq!(
            jobs.iter().find(|job| job.name == "deploy-uat").unwrap().mode,
            JobScheduleMode::Queued
        );
    }

    #[test]
    fn staged_push_to_qa_shows_manual_qa_deploy() {
        use crate::parse_pipeline_yaml;

        let yaml = include_str!("../examples/pertisk-ci-staged.yaml");
        let config = parse_pipeline_yaml(yaml).unwrap();
        let ctx = RunContext::from_trigger("push", "refs/heads/qa");
        let jobs = Scheduler::schedule_for_run(&config, &ctx).unwrap();

        assert_eq!(
            jobs.iter().find(|job| job.name == "unit-test").unwrap().mode,
            JobScheduleMode::Skipped
        );
        assert_eq!(
            jobs.iter().find(|job| job.name == "deploy-qa").unwrap().mode,
            JobScheduleMode::Manual
        );
        assert!(jobs.iter().all(|job| job.mode != JobScheduleMode::Queued));
    }

    #[test]
    fn skips_jobs_when_if_not_met() {
        use crate::job_if::RunContext;

        let config = PipelineConfig {
            on: Triggers::default(),
            jobs: HashMap::from([
                (
                    "build".into(),
                    Job {
                        runs_on: "linux".into(),
                        image: None,
                        environment: None,
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
                        environment: None,
                        dind: false,
                        needs: vec!["build".into()],
                        r#if: Some(JobIfCondition {
                            branch: Some(IfStringList::One("qa".into())),
                            tag: None,
                            event: None,
                            environment: None,
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

        let ctx = RunContext::from_trigger("push", "refs/heads/main");
        let jobs = Scheduler::schedule_for_run(&config, &ctx).unwrap();
        assert_eq!(
            jobs.iter().find(|job| job.name == "build").unwrap().mode,
            JobScheduleMode::Queued
        );
        assert_eq!(
            jobs.iter().find(|job| job.name == "deploy-qa").unwrap().mode,
            JobScheduleMode::Skipped
        );
    }
}
