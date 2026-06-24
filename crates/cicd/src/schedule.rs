use std::collections::{HashMap, HashSet, VecDeque};

use crate::config::{Job, PipelineConfig};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScheduledJob {
    pub name: String,
    pub job: Job,
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
                        runs_on: "self-hosted".into(),
                        needs: vec!["test".into()],
                        required: true,
                        steps: vec![Step {
                            name: None,
                            run: "true".into(),
                            working_directory: None,
                            env: HashMap::new(),
                        }],
                        timeout_minutes: None,
                    },
                ),
                (
                    "test".into(),
                    Job {
                        runs_on: "self-hosted".into(),
                        needs: vec![],
                        required: true,
                        steps: vec![Step {
                            name: None,
                            run: "true".into(),
                            working_directory: None,
                            env: HashMap::new(),
                        }],
                        timeout_minutes: None,
                    },
                ),
            ]),
        };

        let jobs = Scheduler::schedule(&config).unwrap();
        assert_eq!(jobs[0].name, "test");
        assert_eq!(jobs[1].name, "bench");
    }
}
