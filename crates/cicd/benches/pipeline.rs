use indexmap::IndexMap;
use std::collections::HashMap;

use criterion::{black_box, criterion_group, criterion_main, BenchmarkId, Criterion};
use pertisk_cicd::{
    config::{Job, PipelineConfig, Step, Triggers},
    schedule::Scheduler,
    trigger::{PipelineEvent, TriggerMatcher},
    parse_pipeline_yaml,
};

const LARGE_PIPELINE: &str = include_str!("../examples/pertisk-ci-rust-perf.yaml");

fn bench_parse(c: &mut Criterion) {
    let mut group = c.benchmark_group("parse_pipeline_yaml");
    group.bench_function("rust_perf_sample", |b| {
        b.iter(|| parse_pipeline_yaml(black_box(LARGE_PIPELINE)).unwrap());
    });
    group.finish();
}

fn bench_schedule(c: &mut Criterion) {
    let config = parse_pipeline_yaml(LARGE_PIPELINE).unwrap();
    c.bench_function("schedule_jobs", |b| {
        b.iter(|| Scheduler::schedule(black_box(&config)).unwrap());
    });
}

fn bench_trigger_match(c: &mut Criterion) {
    let config = parse_pipeline_yaml(LARGE_PIPELINE).unwrap();
    let event = PipelineEvent::Push {
        branch: "main".into(),
        tag: None,
    };

    c.bench_function("trigger_match", |b| {
        b.iter(|| TriggerMatcher::matches(black_box(&config), black_box(&event)));
    });
}

fn bench_schedule_scaling(c: &mut Criterion) {
    let mut group = c.benchmark_group("schedule_scaling");
    for job_count in [4, 16, 64] {
        let config = synthetic_config(job_count);
        group.bench_with_input(
            BenchmarkId::from_parameter(job_count),
            &config,
            |b, cfg| b.iter(|| Scheduler::schedule(black_box(cfg)).unwrap()),
        );
    }
    group.finish();
}

fn synthetic_config(job_count: usize) -> PipelineConfig {
    let mut jobs = IndexMap::new();
    for i in 0..job_count {
        let name = format!("job-{i}");
        let needs = if i == 0 {
            vec![]
        } else {
            vec![format!("job-{}", i - 1)]
        };
        jobs.insert(
            name,
            Job {
                runs_on: "linux".into(),
                image: None,
                environment: None,
                dind: false,
                needs,
                r#if: None,
                required: true,
                steps: vec![Step {
                    name: Some("noop".into()),
                    run: "true".into(),
                    uses: None,
                    working_directory: None,
                    env: HashMap::new(),
                    with: HashMap::new(),
                }],
                timeout_minutes: None,
                artifacts: vec![],
            },
        );
    }
    PipelineConfig {
        on: Triggers::default(),
        jobs,
    }
}

criterion_group!(
    benches,
    bench_parse,
    bench_schedule,
    bench_trigger_match,
    bench_schedule_scaling
);
criterion_main!(benches);
