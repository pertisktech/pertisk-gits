use std::collections::HashMap;

use crate::config::Job;
use crate::schedule::ScheduledJob;

pub const MAX_JOB_PARALLEL: u32 = 50;

/// Expand jobs with `parallel: N` into N instances and rewrite `needs` edges.
pub fn expand_parallel_jobs(jobs: Vec<ScheduledJob>) -> Vec<ScheduledJob> {
    let expansion_map = build_expansion_map(&jobs);
    let mut expanded = Vec::with_capacity(jobs.len());

    for job in jobs {
        let count = effective_parallel(job.job.parallel);
        if count == 1 {
            let mut job_def = job.job;
            job_def.needs = rewrite_needs(&job_def.needs, &expansion_map);
            expanded.push(ScheduledJob {
                name: job.name,
                job: job_def,
                mode: job.mode,
                skipped_upstream: job.skipped_upstream,
            });
            continue;
        }

        for index in 1..=count {
            let instance_name = parallel_instance_name(&job.name, index, count);
            let mut job_def = job.job.clone();
            job_def.parallel = None;
            job_def.needs = rewrite_needs(&job.job.needs, &expansion_map);
            inject_parallel_env(&mut job_def, index, count);
            expanded.push(ScheduledJob {
                name: instance_name,
                job: job_def,
                mode: job.mode,
                skipped_upstream: job.skipped_upstream,
            });
        }
    }

    expanded
}

pub fn parallel_instance_name(base: &str, index: u32, total: u32) -> String {
    format!("{base} [{index}/{total}]")
}

fn effective_parallel(parallel: Option<u32>) -> u32 {
    parallel.unwrap_or(1).clamp(1, MAX_JOB_PARALLEL)
}

fn build_expansion_map(jobs: &[ScheduledJob]) -> HashMap<String, Vec<String>> {
    jobs.iter()
        .map(|job| {
            let count = effective_parallel(job.job.parallel);
            let instances = if count == 1 {
                vec![job.name.clone()]
            } else {
                (1..=count)
                    .map(|index| parallel_instance_name(&job.name, index, count))
                    .collect()
            };
            (job.name.clone(), instances)
        })
        .collect()
}

fn rewrite_needs(needs: &[String], expansion_map: &HashMap<String, Vec<String>>) -> Vec<String> {
    let mut rewritten = Vec::new();
    for need in needs {
        if let Some(instances) = expansion_map.get(need) {
            rewritten.extend(instances.iter().cloned());
        } else {
            rewritten.push(need.clone());
        }
    }
    rewritten
}

fn inject_parallel_env(job: &mut Job, index: u32, total: u32) {
    let index_value = index.to_string();
    let total_value = total.to_string();
    for step in &mut job.steps {
        step.env.insert("CI_PARALLEL_INDEX".into(), index_value.clone());
        step.env.insert("CI_PARALLEL_TOTAL".into(), total_value.clone());
        step.env.insert("CI_NODE_INDEX".into(), index_value.clone());
        step.env.insert("CI_NODE_TOTAL".into(), total_value.clone());
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use indexmap::IndexMap;

    use super::*;
    use crate::config::{Job, Step, Triggers};
    use crate::job_if::JobScheduleMode;
    use crate::schedule::ScheduledJob;

    fn sample_step() -> Step {
        Step {
            name: None,
            run: "echo test".into(),
            uses: None,
            working_directory: None,
            env: HashMap::new(),
            with: HashMap::new(),
        }
    }

    fn sample_job(parallel: Option<u32>, needs: Vec<&str>) -> Job {
        Job {
            runs_on: "linux".into(),
            image: None,
            environment: None,
            dind: false,
            needs: needs.into_iter().map(str::to_string).collect(),
            r#if: None,
            required: true,
            steps: vec![sample_step()],
            timeout_minutes: None,
            artifacts: vec![],
            parallel,
        }
    }

    #[test]
    fn expands_parallel_job_and_rewrites_downstream_needs() {
        let jobs = vec![
            ScheduledJob {
                name: "test".into(),
                job: sample_job(Some(3), vec![]),
                mode: JobScheduleMode::Queued,
                skipped_upstream: false,
            },
            ScheduledJob {
                name: "report".into(),
                job: sample_job(None, vec!["test"]),
                mode: JobScheduleMode::Queued,
                skipped_upstream: false,
            },
        ];

        let expanded = expand_parallel_jobs(jobs);
        assert_eq!(expanded.len(), 4);
        assert_eq!(expanded[0].name, "test [1/3]");
        assert_eq!(expanded[1].name, "test [2/3]");
        assert_eq!(expanded[2].name, "test [3/3]");
        assert_eq!(
            expanded[3].job.needs,
            vec![
                "test [1/3]".to_string(),
                "test [2/3]".to_string(),
                "test [3/3]".to_string(),
            ]
        );
        assert_eq!(
            expanded[0].job.steps[0].env.get("CI_PARALLEL_INDEX").map(String::as_str),
            Some("1")
        );
        assert_eq!(
            expanded[0].job.steps[0].env.get("CI_PARALLEL_TOTAL").map(String::as_str),
            Some("3")
        );
    }

    #[test]
    fn parallel_job_with_upstream_parallel_waits_for_all_instances() {
        let jobs = vec![
            ScheduledJob {
                name: "build".into(),
                job: sample_job(Some(2), vec![]),
                mode: JobScheduleMode::Queued,
                skipped_upstream: false,
            },
            ScheduledJob {
                name: "verify".into(),
                job: sample_job(Some(2), vec!["build"]),
                mode: JobScheduleMode::Queued,
                skipped_upstream: false,
            },
        ];

        let expanded = expand_parallel_jobs(jobs);
        let verify = expanded
            .iter()
            .find(|job| job.name == "verify [1/2]")
            .expect("verify instance");
        assert_eq!(
            verify.job.needs,
            vec!["build [1/2]".to_string(), "build [2/2]".to_string()]
        );
    }

    #[test]
    fn ignores_parallel_one() {
        let config = crate::config::PipelineConfig {
            on: Triggers::default(),
            jobs: IndexMap::from([(
                "test".into(),
                sample_job(Some(1), vec![]),
            )]),
        };
        let jobs = crate::schedule::Scheduler::schedule(&config).unwrap();
        let expanded = expand_parallel_jobs(jobs);
        assert_eq!(expanded.len(), 1);
        assert_eq!(expanded[0].name, "test");
    }
}
