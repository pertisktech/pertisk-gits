use std::cmp::Ordering;
use std::collections::{HashMap, HashSet, VecDeque};

use crate::config::{Job, PipelineConfig};
use crate::job_if::{JobIfMatcher, JobScheduleMode, RunContext};
use crate::parallel::expand_parallel_jobs;
use crate::trigger::matches_pipeline_trigger;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScheduledJob {
    pub name: String,
    pub job: Job,
    pub mode: JobScheduleMode,
    /// Skipped because a `needs:` dependency was skipped (not because `if:` failed).
    pub skipped_upstream: bool,
}

/// How a scheduled job should be reset when a pipeline is re-run.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RerunReset {
    /// Re-run all jobs — manual play jobs stay manual (click play again).
    PipelineAll,
    /// Re-run failed jobs or a specific job (+ downstream) — manual jobs run immediately.
    Jobs,
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
            JobScheduleMode::Skipped if self.skipped_upstream => {
                "=== skipped (not run — upstream job skipped)\n"
            }
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

    fn rerun_as_skipped(&self, reset: RerunReset) -> bool {
        match self.mode {
            JobScheduleMode::Skipped if self.skipped_upstream => reset == RerunReset::PipelineAll,
            JobScheduleMode::Skipped => true,
            _ => false,
        }
    }

    pub fn rerun_db_status(&self, reset: RerunReset) -> &'static str {
        if self.rerun_as_skipped(reset) {
            "skipped"
        } else if self.mode == JobScheduleMode::Manual && reset == RerunReset::PipelineAll {
            "manual"
        } else {
            "queued"
        }
    }

    pub fn rerun_initial_log(&self, reset: RerunReset) -> &'static str {
        if self.mode == JobScheduleMode::Manual && reset == RerunReset::PipelineAll {
            return self.initial_log();
        }
        if self.rerun_as_skipped(reset) {
            self.initial_log()
        } else {
            ""
        }
    }

    pub fn rerun_finishes_immediately(&self, reset: RerunReset) -> bool {
        self.rerun_as_skipped(reset)
    }

    pub fn rerun_commit_status(&self, reset: RerunReset) -> (&'static str, &'static str) {
        if self.mode == JobScheduleMode::Manual && reset == RerunReset::PipelineAll {
            return self.commit_status();
        }
        if self.rerun_as_skipped(reset) {
            self.commit_status()
        } else {
            ("pending", "Queued")
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
    /// Build the run context used to evaluate job `if:` rules.
    ///
    /// Manual Run pipeline **without** a chosen environment on a branch that would auto-trigger
    /// on push uses the same schedule as push — identical job graph on the same ref.
    pub fn build_schedule_context(
        config: &PipelineConfig,
        event_type: &str,
        ref_name: &str,
        schedule_env: Option<String>,
        environment_explicit: bool,
    ) -> RunContext {
        let mirror_push = event_type == "manual"
            && !environment_explicit
            && matches_pipeline_trigger(config, "push", ref_name);
        let schedule_event = if mirror_push { "push" } else { event_type };
        RunContext::from_trigger_with_environment(
            schedule_event,
            ref_name,
            schedule_env,
            environment_explicit && event_type == "manual",
        )
    }

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
        let mut skipped_upstream: HashSet<String> = HashSet::new();

        loop {
            let mut changed = false;
            for job in &ordered {
                if modes.get(&job.name) == Some(&JobScheduleMode::Skipped) {
                    continue;
                }
                // GitLab-style: manual jobs stay visible even when upstream jobs are skipped by `if:`.
                if modes.get(&job.name) == Some(&JobScheduleMode::Manual) {
                    continue;
                }
                for need in &job.job.needs {
                    if modes.get(need) == Some(&JobScheduleMode::Skipped)
                        || modes.get(need) == Some(&JobScheduleMode::Manual)
                    {
                        modes.insert(job.name.clone(), JobScheduleMode::Skipped);
                        skipped_upstream.insert(job.name.clone());
                        changed = true;
                        break;
                    }
                }
            }
            if !changed {
                break;
            }
        }

        let scheduled = ordered
            .into_iter()
            .map(|job| ScheduledJob {
                mode: modes
                    .get(&job.name)
                    .copied()
                    .unwrap_or(JobScheduleMode::Skipped),
                skipped_upstream: skipped_upstream.contains(&job.name),
                name: job.name,
                job: job.job,
            })
            .collect();

        Ok(expand_parallel_jobs(scheduled))
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
        sort_job_queue(config, &mut queue);

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
                skipped_upstream: false,
            });

            if let Some(children) = dependents.get(name) {
                let mut next: Vec<&str> = children.clone();
                sort_job_names(config, &mut next);
                for child in next {
                    let entry = indegree.get_mut(child).unwrap();
                    *entry -= 1;
                    if *entry == 0 {
                        queue.push_back(child);
                    }
                }
                sort_job_queue(config, &mut queue);
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

fn compare_job_names(config: &PipelineConfig, a: &str, b: &str) -> Ordering {
    let job_a = config.jobs.get(a).expect("job in schedule");
    let job_b = config.jobs.get(b).expect("job in schedule");
    let manual_a = JobIfMatcher::requires_manual_event(job_a.r#if.as_ref());
    let manual_b = JobIfMatcher::requires_manual_event(job_b.r#if.as_ref());
    manual_a
        .cmp(&manual_b)
        .then_with(|| {
            config
                .jobs
                .get_index_of(a)
                .unwrap_or(0)
                .cmp(&config.jobs.get_index_of(b).unwrap_or(0))
        })
}

fn sort_job_names(config: &PipelineConfig, names: &mut [&str]) {
    names.sort_by(|a, b| compare_job_names(config, a, b));
}

fn sort_job_queue(config: &PipelineConfig, queue: &mut VecDeque<&str>) {
    queue.make_contiguous().sort_by(|a, b| compare_job_names(config, a, b));
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

use indexmap::IndexMap;

    use super::*;
    use crate::config::{Job, Step, Triggers};
    use crate::job_if::{JobIfCondition, IfStringList, RunContext};

    #[test]
    fn manual_root_jobs_sort_after_automatic() {
        use crate::job_if::{IfStringList, IfTagCondition, JobIfCondition};

        let step = Step {
            name: None,
            run: "true".into(),
            uses: None,
            working_directory: None,
            env: HashMap::new(),
            with: HashMap::new(),
        };
        let config = PipelineConfig {
            on: Triggers::default(),
            jobs: IndexMap::from([
                (
                    "scanner-file".into(),
                    Job {
                        runs_on: "linux".into(),
                        image: None,
                        environment: None,
                        dind: false,
                        needs: vec![],
                        r#if: None,
                        required: true,
                        steps: vec![step.clone()],
                        timeout_minutes: None,
                        artifacts: vec![],
                        parallel: None,
                    },
                ),
                (
                    "release-tag".into(),
                    Job {
                        runs_on: "linux".into(),
                        image: None,
                        environment: None,
                        dind: false,
                        needs: vec![],
                        r#if: Some(JobIfCondition {
                            branch: None,
                            tag: Some(IfTagCondition::Pattern("*".into())),
                            event: Some(IfStringList::One("manual".into())),
                            environment: None,
                        }),
                        required: true,
                        steps: vec![step],
                        timeout_minutes: None,
                        artifacts: vec![],
                        parallel: None,
                    },
                ),
            ]),
        };

        let jobs = Scheduler::schedule(&config).unwrap();
        assert_eq!(jobs[0].name, "scanner-file");
        assert_eq!(jobs[1].name, "release-tag");
    }

    #[test]
    fn orders_by_needs() {
        let config = PipelineConfig {
            on: Triggers::default(),
            jobs: IndexMap::from([
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
                        parallel: None,
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
                        parallel: None,
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
            JobScheduleMode::Manual
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
            true,
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
            true,
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
    fn manual_without_env_on_main_matches_push_schedule() {
        use crate::parse_pipeline_yaml;

        let yaml = include_str!("../examples/pertisk-ci-staged.yaml");
        let config = parse_pipeline_yaml(yaml).unwrap();
        let push_jobs = Scheduler::schedule_for_run(
            &config,
            &RunContext::from_trigger("push", "refs/heads/main"),
        )
        .unwrap();
        let manual_jobs = Scheduler::schedule_for_run(
            &config,
            &Scheduler::build_schedule_context(
                &config,
                "manual",
                "refs/heads/main",
                RunContext::from_trigger("push", "refs/heads/main").environment,
                false,
            ),
        )
        .unwrap();

        for push_job in &push_jobs {
            let manual_job = manual_jobs
                .iter()
                .find(|job| job.name == push_job.name)
                .unwrap_or_else(|| panic!("missing job {} on manual run", push_job.name));
            assert_eq!(
                manual_job.mode, push_job.mode,
                "job {} mode differs between push and manual",
                push_job.name
            );
        }
        assert_eq!(
            manual_jobs.iter().filter(|job| !job.skipped()).count(),
            push_jobs.iter().filter(|job| !job.skipped()).count(),
        );
    }

    #[test]
    fn staged_manual_main_without_explicit_shows_env_manual_jobs() {
        use crate::parse_pipeline_yaml;

        let yaml = include_str!("../examples/pertisk-ci-staged.yaml");
        let config = parse_pipeline_yaml(yaml).unwrap();
        let ctx = RunContext::from_trigger_with_environment(
            "manual",
            "refs/heads/main",
            None,
            false,
        );
        let jobs = Scheduler::schedule_for_run(&config, &ctx).unwrap();

        assert_eq!(
            jobs.iter().find(|job| job.name == "deploy-qa").unwrap().mode,
            JobScheduleMode::Manual
        );
        assert_eq!(
            jobs.iter().find(|job| job.name == "deploy-uat").unwrap().mode,
            JobScheduleMode::Manual
        );
    }

    #[test]
    fn staged_manual_main_play_jobs_not_in_run_pipeline() {
        use crate::parse_pipeline_yaml;

        let yaml = include_str!("../examples/pertisk-ci-staged.yaml");
        let config = parse_pipeline_yaml(yaml).unwrap();
        let ctx = RunContext::from_trigger_with_environment(
            "manual",
            "refs/heads/main",
            Some("dev".into()),
            true,
        );
        let jobs = Scheduler::schedule_for_run(&config, &ctx).unwrap();

        assert_eq!(
            jobs.iter().find(|job| job.name == "deploy-qa-manual").unwrap().mode,
            JobScheduleMode::Skipped
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
            jobs: IndexMap::from([
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
                        parallel: None,
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
                        parallel: None,
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

    #[test]
    fn scheduled_job_metadata() {
        let job = ScheduledJob {
            name: "deploy".into(),
            job: Job {
                runs_on: "linux".into(),
                image: None,
                environment: None,
                dind: false,
                needs: vec![],
                r#if: None,
                required: true,
                steps: vec![],
                timeout_minutes: None,
                artifacts: vec![],
                parallel: None,
            },
            mode: JobScheduleMode::Manual,
            skipped_upstream: false,
        };
        assert!(!job.skipped());
        assert_eq!(job.db_status(), "manual");
        assert!(job.initial_log().contains("manual trigger"));
        assert!(!job.finishes_immediately());
        assert_eq!(job.commit_status(), ("pending", "Manual"));

        let skipped = ScheduledJob {
            name: "deploy".into(),
            job: job.job.clone(),
            mode: JobScheduleMode::Skipped,
            skipped_upstream: false,
        };
        assert!(skipped.skipped());
        assert!(skipped.initial_log().contains("if condition not met"));
        assert!(skipped.finishes_immediately());
        assert_eq!(skipped.commit_status(), ("success", "Skipped"));

        let upstream_skipped = ScheduledJob {
            name: "deploy".into(),
            job: job.job.clone(),
            mode: JobScheduleMode::Skipped,
            skipped_upstream: true,
        };
        assert!(upstream_skipped.initial_log().contains("upstream job skipped"));

        let queued = ScheduledJob {
            name: "build".into(),
            job: job.job.clone(),
            mode: JobScheduleMode::Queued,
            skipped_upstream: false,
        };
        assert_eq!(queued.db_status(), "queued");
        assert_eq!(queued.initial_log(), "");
        assert!(!queued.finishes_immediately());
        assert_eq!(queued.commit_status(), ("pending", "Queued"));

        assert_eq!(job.rerun_db_status(RerunReset::Jobs), "queued");
        assert_eq!(job.rerun_initial_log(RerunReset::Jobs), "");
        assert!(!job.rerun_finishes_immediately(RerunReset::Jobs));
        assert_eq!(job.rerun_commit_status(RerunReset::Jobs), ("pending", "Queued"));
        assert_eq!(job.rerun_db_status(RerunReset::PipelineAll), "manual");
        assert!(job.rerun_initial_log(RerunReset::PipelineAll).contains("manual trigger"));
        assert!(!job.rerun_finishes_immediately(RerunReset::PipelineAll));
        assert_eq!(
            job.rerun_commit_status(RerunReset::PipelineAll),
            ("pending", "Manual")
        );
        assert_eq!(skipped.rerun_db_status(RerunReset::Jobs), "skipped");

        let downstream = ScheduledJob {
            name: "health-check-qa".into(),
            job: job.job.clone(),
            mode: JobScheduleMode::Skipped,
            skipped_upstream: true,
        };
        assert_eq!(downstream.rerun_db_status(RerunReset::Jobs), "queued");
        assert_eq!(downstream.rerun_db_status(RerunReset::PipelineAll), "skipped");
        assert_eq!(downstream.rerun_initial_log(RerunReset::Jobs), "");
        assert!(!downstream.rerun_finishes_immediately(RerunReset::Jobs));
        assert_eq!(downstream.rerun_commit_status(RerunReset::Jobs), ("pending", "Queued"));
    }

    #[test]
    fn push_manual_deploy_keeps_qa_downstream_skipped_until_play() {
        use crate::job_if::{IfStringList, JobIfCondition, RunContext};

        let config = PipelineConfig {
            on: Triggers::default(),
            jobs: IndexMap::from([
                (
                    "e2e-dev".into(),
                    Job {
                        runs_on: "linux".into(),
                        image: None,
                        environment: None,
                        dind: false,
                        needs: vec![],
                        r#if: Some(JobIfCondition {
                            branch: Some(IfStringList::One("main".into())),
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
                        parallel: None,
                    },
                ),
                (
                    "deploy-qa".into(),
                    Job {
                        runs_on: "linux".into(),
                        image: None,
                        environment: None,
                        dind: false,
                        needs: vec!["e2e-dev".into()],
                        r#if: Some(JobIfCondition {
                            branch: Some(IfStringList::One("main".into())),
                            tag: None,
                            event: Some(IfStringList::One("manual".into())),
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
                        parallel: None,
                    },
                ),
                (
                    "health-check-qa".into(),
                    Job {
                        runs_on: "linux".into(),
                        image: None,
                        environment: None,
                        dind: false,
                        needs: vec!["deploy-qa".into()],
                        r#if: Some(JobIfCondition {
                            branch: Some(IfStringList::One("main".into())),
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
                        parallel: None,
                    },
                ),
            ]),
        };

        let jobs = Scheduler::schedule_for_run(
            &config,
            &RunContext::from_trigger("push", "refs/heads/main"),
        )
        .unwrap();

        let deploy_qa = jobs.iter().find(|job| job.name == "deploy-qa").unwrap();
        let health = jobs
            .iter()
            .find(|job| job.name == "health-check-qa")
            .unwrap();

        assert_eq!(deploy_qa.mode, JobScheduleMode::Manual);
        assert_eq!(deploy_qa.db_status(), "manual");
        assert_eq!(health.mode, JobScheduleMode::Skipped);
        assert!(health.skipped_upstream);
        assert_eq!(health.db_status(), "skipped");

        assert_eq!(deploy_qa.rerun_db_status(RerunReset::PipelineAll), "manual");
        assert_eq!(health.rerun_db_status(RerunReset::PipelineAll), "skipped");
        assert_eq!(deploy_qa.rerun_db_status(RerunReset::Jobs), "queued");
        assert_eq!(health.rerun_db_status(RerunReset::Jobs), "queued");
    }

    #[test]
    fn unknown_dependency_errors() {
        let config = PipelineConfig {
            on: Triggers::default(),
            jobs: IndexMap::from([(
                "build".into(),
                Job {
                    runs_on: "linux".into(),
                    image: None,
                    environment: None,
                    dind: false,
                    needs: vec!["missing".into()],
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
                    parallel: None,
                },
            )]),
        };
        assert!(matches!(
            Scheduler::schedule(&config),
            Err(ScheduleError::UnknownDependency(dep)) if dep == "missing"
        ));
    }

    #[test]
    fn cycle_detection_errors() {
        let config = PipelineConfig {
            on: Triggers::default(),
            jobs: IndexMap::from([
                (
                    "a".into(),
                    Job {
                        runs_on: "linux".into(),
                        image: None,
                        environment: None,
                        dind: false,
                        needs: vec!["b".into()],
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
                        parallel: None,
                    },
                ),
                (
                    "b".into(),
                    Job {
                        runs_on: "linux".into(),
                        image: None,
                        environment: None,
                        dind: false,
                        needs: vec!["a".into()],
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
                        parallel: None,
                    },
                ),
            ]),
        };
        assert!(matches!(
            Scheduler::schedule(&config),
            Err(ScheduleError::Cycle(_))
        ));
    }

    #[test]
    fn skips_downstream_when_needed_job_skipped() {
        let config = PipelineConfig {
            on: Triggers::default(),
            jobs: IndexMap::from([
                (
                    "build".into(),
                    Job {
                        runs_on: "linux".into(),
                        image: None,
                        environment: None,
                        dind: false,
                        needs: vec![],
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
                        parallel: None,
                    },
                ),
                (
                    "deploy".into(),
                    Job {
                        runs_on: "linux".into(),
                        image: None,
                        environment: None,
                        dind: false,
                        needs: vec!["build".into()],
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
                        parallel: None,
                    },
                ),
            ]),
        };
        let ctx = RunContext::from_trigger("push", "refs/heads/main");
        let jobs = Scheduler::schedule_for_run(&config, &ctx).unwrap();
        assert_eq!(
            jobs.iter().find(|job| job.name == "build").unwrap().mode,
            JobScheduleMode::Skipped
        );
        assert_eq!(
            jobs.iter().find(|job| job.name == "deploy").unwrap().mode,
            JobScheduleMode::Skipped
        );
    }

    #[test]
    fn skips_downstream_when_needed_job_is_manual() {
        use crate::job_if::{IfStringList, JobIfCondition};

        let step = Step {
            name: None,
            run: "true".into(),
            uses: None,
            working_directory: None,
            env: HashMap::new(),
            with: HashMap::new(),
        };
        let config = PipelineConfig {
            on: Triggers::default(),
            jobs: IndexMap::from([
                (
                    "e2e-dev".into(),
                    Job {
                        runs_on: "linux".into(),
                        image: None,
                        environment: None,
                        dind: false,
                        needs: vec![],
                        r#if: Some(JobIfCondition {
                            branch: Some(IfStringList::One("main".into())),
                            tag: None,
                            event: None,
                            environment: None,
                        }),
                        required: true,
                        steps: vec![step.clone()],
                        timeout_minutes: None,
                        artifacts: vec![],
                        parallel: None,
                    },
                ),
                (
                    "deploy-qa".into(),
                    Job {
                        runs_on: "linux".into(),
                        image: None,
                        environment: Some("qa".into()),
                        dind: false,
                        needs: vec!["e2e-dev".into()],
                        r#if: Some(JobIfCondition {
                            branch: Some(IfStringList::One("main".into())),
                            tag: None,
                            event: Some(IfStringList::One("manual".into())),
                            environment: None,
                        }),
                        required: true,
                        steps: vec![step.clone()],
                        timeout_minutes: None,
                        artifacts: vec![],
                        parallel: None,
                    },
                ),
                (
                    "health-check-qa".into(),
                    Job {
                        runs_on: "linux".into(),
                        image: None,
                        environment: Some("qa".into()),
                        dind: false,
                        needs: vec!["deploy-qa".into()],
                        r#if: Some(JobIfCondition {
                            branch: Some(IfStringList::One("main".into())),
                            tag: None,
                            event: None,
                            environment: None,
                        }),
                        required: true,
                        steps: vec![step],
                        timeout_minutes: None,
                        artifacts: vec![],
                        parallel: None,
                    },
                ),
            ]),
        };

        let ctx = RunContext::from_trigger("push", "refs/heads/main");
        let jobs = Scheduler::schedule_for_run(&config, &ctx).unwrap();

        assert_eq!(
            jobs.iter().find(|job| job.name == "deploy-qa").unwrap().mode,
            JobScheduleMode::Manual
        );
        assert_eq!(
            jobs.iter().find(|job| job.name == "health-check-qa").unwrap().mode,
            JobScheduleMode::Skipped
        );
        assert!(
            jobs
                .iter()
                .find(|job| job.name == "health-check-qa")
                .unwrap()
                .skipped_upstream
        );
    }

    #[test]
    fn manual_job_stays_visible_when_upstream_skipped_by_if() {
        use crate::job_if::{IfStringList, JobIfCondition};

        let step = Step {
            name: None,
            run: "true".into(),
            uses: None,
            working_directory: None,
            env: HashMap::new(),
            with: HashMap::new(),
        };
        let config = PipelineConfig {
            on: Triggers::default(),
            jobs: IndexMap::from([
                (
                    "e2e-test-dev".into(),
                    Job {
                        runs_on: "linux".into(),
                        image: None,
                        environment: None,
                        dind: false,
                        needs: vec![],
                        r#if: Some(JobIfCondition {
                            branch: Some(IfStringList::One("main".into())),
                            tag: None,
                            event: Some(IfStringList::One("push".into())),
                            environment: Some(IfStringList::One("dev".into())),
                        }),
                        required: true,
                        steps: vec![step.clone()],
                        timeout_minutes: None,
                        artifacts: vec![],
                        parallel: None,
                    },
                ),
                (
                    "deploy-qa".into(),
                    Job {
                        runs_on: "linux".into(),
                        image: None,
                        environment: Some("qa".into()),
                        dind: false,
                        needs: vec!["e2e-test-dev".into()],
                        r#if: Some(JobIfCondition {
                            branch: None,
                            tag: None,
                            event: Some(IfStringList::One("manual".into())),
                            environment: Some(IfStringList::One("qa".into())),
                        }),
                        required: true,
                        steps: vec![step],
                        timeout_minutes: None,
                        artifacts: vec![],
                        parallel: None,
                    },
                ),
            ]),
        };

        let ctx = RunContext::from_trigger_with_environment(
            "manual",
            "refs/heads/main",
            None,
            false,
        );
        let jobs = Scheduler::schedule_for_run(&config, &ctx).unwrap();

        assert_eq!(
            jobs.iter().find(|job| job.name == "e2e-test-dev").unwrap().mode,
            JobScheduleMode::Skipped
        );
        assert_eq!(
            jobs.iter().find(|job| job.name == "deploy-qa").unwrap().mode,
            JobScheduleMode::Manual
        );
    }

    #[test]
    fn schedule_for_run_expands_parallel_jobs() {
        let config = PipelineConfig {
            on: Triggers::default(),
            jobs: IndexMap::from([
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
                        parallel: Some(2),
                    },
                ),
                (
                    "report".into(),
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
                        parallel: None,
                    },
                ),
            ]),
        };

        let ctx = RunContext::from_trigger("push", "refs/heads/main");
        let jobs = Scheduler::schedule_for_run(&config, &ctx).unwrap();
        assert_eq!(jobs.len(), 3);
        assert!(jobs.iter().any(|job| job.name == "test [1/2]"));
        assert!(jobs.iter().any(|job| job.name == "test [2/2]"));
        let report = jobs.iter().find(|job| job.name == "report").unwrap();
        assert_eq!(
            report.job.needs,
            vec!["test [1/2]".to_string(), "test [2/2]".to_string()]
        );
    }
}
