use std::collections::BTreeMap;
use std::time::{Duration, Instant};

use anyhow::Context;
use chrono::Utc;
use futures::AsyncBufReadExt;
use k8s_openapi::api::batch::v1::Job;
use k8s_openapi::api::core::v1::{
    ConfigMap, ConfigMapVolumeSource, Container, EnvVar, PodSpec, PodTemplateSpec, Volume,
    VolumeMount,
};
use k8s_openapi::apimachinery::pkg::apis::meta::v1::ObjectMeta;
use kube::api::{DeleteParams, ListParams, LogParams, PostParams};
use kube::{Api, Client};
use pertisk_cicd::apply_secrets_to_step;
use pertisk_cicd::metrics::{JobMetrics, StepTiming};
use pertisk_cicd::render_job_script;
use tempfile::TempDir;
use uuid::Uuid;

use super::config::{job_resource_name, K8sExecutorConfig};
use crate::api::{PollJobResponse, RunnerApi};
use crate::job::prepare_secrets;
use crate::log_stream::LogStreamer;

pub async fn run_job(api: &RunnerApi, job: PollJobResponse) -> anyhow::Result<()> {
    let config = K8sExecutorConfig::from_env();
    let client = Client::try_default()
        .await
        .context("connect to Kubernetes API (in-cluster or kubeconfig)")?;

    let job_name = job_resource_name(job.job_id);
    let script_cm_name = format!("{job_name}-script");

    tracing::info!(
        job = %job.job_name,
        k8s_job = %job_name,
        namespace = %config.namespace,
        executor = "kubernetes",
        "creating Kubernetes job pod"
    );

    let queued_at = Instant::now();
    api.start_job(job.job_id).await?;
    api.append_log(
        job.job_id,
        &format!("=== kubernetes job {job_name} (creating)\n"),
    )
    .await?;

    let work_root = TempDir::with_prefix("pertisk-k8s-secrets-")?;
    let secrets = prepare_secrets(api, job.job_id, work_root.path()).await?;

    let resolved_steps: Vec<_> = job
        .steps
        .iter()
        .map(|step| apply_secrets_to_step(step, &secrets.injection))
        .collect();

    let mut extra_env = secrets.injection.clone();
    extra_env.insert("CI_COMMIT_SHA".into(), job.commit_sha.clone());
    extra_env.insert(
        "CI_REPOSITORY_SLUG".into(),
        format!("{}/{}", job.org_slug, job.repo_slug),
    );

    let script = render_job_script(
        &config.workspace_mount_path,
        &resolved_steps,
        &job.artifacts,
        &extra_env,
    );

    let labels = job_labels(&job_name, job.job_id);
    create_script_configmap(&client, &config.namespace, &script_cm_name, &script, &labels).await?;

    let k8s_job = build_job_spec(
        &config,
        &job_name,
        &script_cm_name,
        &labels,
        api,
        job.job_id,
        job.timeout_minutes,
    );

    let jobs: Api<Job> = Api::namespaced(client.clone(), &config.namespace);
    if let Err(err) = jobs.create(&PostParams::default(), &k8s_job).await {
        let _ = delete_configmap(&client, &config.namespace, &script_cm_name).await;
        return Err(err).context("create Kubernetes Job");
    }

    let _ = api
        .upsert_k8s_pod(
            job.job_id,
            &config.namespace,
            &job_name,
            None,
            "pending",
            false,
        )
        .await;

    let result = watch_job(
        &client,
        &config.namespace,
        &job_name,
        api,
        job.job_id,
        secrets.mask_values,
        job.timeout_minutes,
    )
    .await;

    let _ = jobs.delete(&job_name, &DeleteParams::default()).await;
    let _ = delete_configmap(&client, &config.namespace, &script_cm_name).await;

    let (exit_code, cancelled, timed_out) = result?;

    let queue_wait = queued_at.elapsed();
    let finished_at = Utc::now();
    let started_at = finished_at - chrono::Duration::milliseconds(queue_wait.as_millis() as i64);
    let timings = vec![StepTiming {
        name: job.job_name.clone(),
        duration_ms: queue_wait.as_millis() as u64,
        exit_code,
        started_at,
        finished_at,
    }];
    let metrics = JobMetrics::from_step_timings(&job.job_name, timings, queue_wait);

    let status = if timed_out || exit_code != 0 {
        "failure"
    } else if cancelled {
        "cancelled"
    } else {
        "success"
    };

    let metrics_json = serde_json::to_value(&metrics).ok();
    api.complete_job(job.job_id, status, None, metrics_json).await?;
    tracing::info!(job = %job.job_name, status, k8s_job = %job_name, "kubernetes job finished");
    Ok(())
}

fn job_labels(job_name: &str, job_id: Uuid) -> BTreeMap<String, String> {
    BTreeMap::from([
        ("app.kubernetes.io/name".into(), "pertisk-ci-job".into()),
        ("pertisk.dev/job-id".into(), job_id.to_string()),
        ("pertisk.dev/k8s-job".into(), job_name.into()),
    ])
}

async fn create_script_configmap(
    client: &Client,
    namespace: &str,
    name: &str,
    script: &str,
    labels: &BTreeMap<String, String>,
) -> anyhow::Result<()> {
    let cms: Api<ConfigMap> = Api::namespaced(client.clone(), namespace);
    let cm = ConfigMap {
        metadata: ObjectMeta {
            name: Some(name.to_string()),
            labels: Some(labels.clone()),
            ..Default::default()
        },
        data: Some(BTreeMap::from([("run.sh".into(), script.to_string())])),
        ..Default::default()
    };
    cms.create(&PostParams::default(), &cm)
        .await
        .context("create script ConfigMap")?;
    Ok(())
}

async fn delete_configmap(client: &Client, namespace: &str, name: &str) -> anyhow::Result<()> {
    let cms: Api<ConfigMap> = Api::namespaced(client.clone(), namespace);
    let _ = cms.delete(name, &DeleteParams::default()).await;
    Ok(())
}

fn build_job_spec(
    config: &K8sExecutorConfig,
    job_name: &str,
    script_cm_name: &str,
    labels: &BTreeMap<String, String>,
    api: &RunnerApi,
    job_id: Uuid,
    timeout_minutes: Option<u32>,
) -> Job {
    let workspace = config.workspace_mount_path.clone();
    let init_script = format!(
        r#"set -euo pipefail
mkdir -p {workspace}
curl -sfS -H "Authorization: Bearer ${{PERTISK_RUNNER_TOKEN}}" \
  "${{PERTISK_API_URL}}/api/v1/runner/jobs/${{PERTISK_JOB_ID}}/workspace" \
  -o /tmp/workspace.tgz
tar xzf /tmp/workspace.tgz -C {workspace}
echo "=== helper: workspace ready"
"#
    );

    let common_env = vec![
        env_var("PERTISK_API_URL", api.api_url()),
        env_var("PERTISK_RUNNER_TOKEN", api.token()),
        env_var("PERTISK_JOB_ID", &job_id.to_string()),
    ];

    let helper = Container {
        name: "helper".into(),
        image: Some(config.helper_image.clone()),
        command: Some(vec!["/bin/sh".into(), "-c".into()]),
        args: Some(vec![init_script]),
        env: Some(common_env.clone()),
        volume_mounts: Some(vec![VolumeMount {
            name: "workspace".into(),
            mount_path: workspace.clone(),
            ..Default::default()
        }]),
        ..Default::default()
    };

    let build = Container {
        name: "build".into(),
        image: Some(config.build_image.clone()),
        command: Some(vec!["/bin/bash".into(), "/scripts/run.sh".into()]),
        env: Some(common_env),
        volume_mounts: Some(vec![
            VolumeMount {
                name: "workspace".into(),
                mount_path: workspace,
                ..Default::default()
            },
            VolumeMount {
                name: "scripts".into(),
                mount_path: "/scripts".into(),
                read_only: Some(true),
                ..Default::default()
            },
        ]),
        ..Default::default()
    };

    let mut pod_labels = labels.clone();
    pod_labels.insert("job-name".into(), job_name.into());

    let mut spec = PodSpec {
        restart_policy: Some("Never".into()),
        init_containers: Some(vec![helper]),
        containers: vec![build],
        volumes: Some(vec![
            Volume {
                name: "workspace".into(),
                empty_dir: Some(Default::default()),
                ..Default::default()
            },
            Volume {
                name: "scripts".into(),
                config_map: Some(ConfigMapVolumeSource {
                    name: script_cm_name.into(),
                    default_mode: Some(0o755),
                    ..Default::default()
                }),
                ..Default::default()
            },
        ]),
        ..Default::default()
    };

    if let Some(sa) = &config.service_account {
        spec.service_account_name = Some(sa.clone());
    }
    if !config.node_selector.is_empty() {
        spec.node_selector = Some(config.node_selector.clone());
    }

    let active_deadline = timeout_minutes.map(|m| m as i64 * 60);

    Job {
        metadata: ObjectMeta {
            name: Some(job_name.into()),
            labels: Some(labels.clone()),
            ..Default::default()
        },
        spec: Some(k8s_openapi::api::batch::v1::JobSpec {
            backoff_limit: Some(0),
            ttl_seconds_after_finished: Some(config.ttl_seconds_after_finished),
            active_deadline_seconds: active_deadline,
            template: PodTemplateSpec {
                metadata: Some(ObjectMeta {
                    labels: Some(pod_labels),
                    ..Default::default()
                }),
                spec: Some(spec),
            },
            ..Default::default()
        }),
        ..Default::default()
    }
}

fn env_var(name: &str, value: &str) -> EnvVar {
    EnvVar {
        name: name.into(),
        value: Some(value.into()),
        ..Default::default()
    }
}

async fn watch_job(
    client: &Client,
    namespace: &str,
    job_name: &str,
    api: &RunnerApi,
    job_id: Uuid,
    mask_values: Vec<String>,
    timeout_minutes: Option<u32>,
) -> anyhow::Result<(i32, bool, bool)> {
    let pods: Api<k8s_openapi::api::core::v1::Pod> = Api::namespaced(client.clone(), namespace);
    let jobs: Api<Job> = Api::namespaced(client.clone(), namespace);

    let pod_name = wait_for_pod(&pods, job_name).await?;
    let _ = api
        .upsert_k8s_pod(
            job_id,
            namespace,
            job_name,
            Some(&pod_name),
            "running",
            false,
        )
        .await;
    api.append_log(job_id, &format!("=== kubernetes pod {pod_name} (running)\n"))
        .await?;

    let poll_api = api.clone_for_poll();
    let cancel_job_name = job_name.to_string();
    let cancel_namespace = namespace.to_string();
    let cancel_client = client.clone();
    let cancel_handle = tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_millis(500)).await;
            let Ok(control) = poll_api.fetch_job_control(job_id).await else {
                continue;
            };
            if control.should_cancel_job() || control.timed_out {
                let jobs: Api<Job> =
                    Api::namespaced(cancel_client.clone(), &cancel_namespace);
                let _ = jobs
                    .delete(&cancel_job_name, &DeleteParams::default())
                    .await;
                return (control.timed_out, true);
            }
        }
    });

    let mut streamer = LogStreamer::new(api, job_id, mask_values);
    let log_params = LogParams {
        container: Some("build".into()),
        follow: true,
        ..Default::default()
    };
    let mut log_stream = pods
        .log_stream(&pod_name, &log_params)
        .await
        .context("stream build container logs")?;
    let mut line_buf = Vec::new();
    loop {
        line_buf.clear();
        let read = log_stream.read_until(b'\n', &mut line_buf).await?;
        if read == 0 {
            break;
        }
        let chunk = String::from_utf8_lossy(&line_buf);
        streamer.push(&chunk).await;
    }
    streamer.flush().await;

    cancel_handle.abort();

    let job = jobs.get(job_name).await.context("read Job status")?;
    let mut exit_code = 1_i32;
    let mut timed_out = false;

    if let Some(status) = &job.status {
        if status.conditions.as_ref().is_some_and(|conds| {
            conds.iter().any(|c| c.type_ == "Failed" && c.reason.as_deref() == Some("DeadlineExceeded"))
        }) {
            timed_out = true;
            api.append_log(
                job_id,
                &format!(
                    "\n=== job timed out after {} minutes\n",
                    timeout_minutes.unwrap_or(0)
                ),
            )
            .await?;
        }
        if let Some(succeeded) = status.succeeded {
            if succeeded > 0 {
                exit_code = 0;
            }
        }
        if let Some(failed) = status.failed {
            if failed > 0 && exit_code != 0 {
                exit_code = 1;
            }
        }
    }

    let pod = pods.get(&pod_name).await.ok();
    if let Some(pod) = pod {
        if let Some(state) = pod
            .status
            .as_ref()
            .and_then(|s| s.container_statuses.as_ref())
            .and_then(|statuses| statuses.iter().find(|s| s.name == "build"))
            .and_then(|s| s.state.as_ref())
            .and_then(|s| s.terminated.as_ref())
        {
            exit_code = state.exit_code;
            if state.reason.as_deref() == Some("DeadlineExceeded") {
                timed_out = true;
            }
        }
    }

    let cancelled = api
        .fetch_job_control(job_id)
        .await
        .map(|c| c.should_cancel_job())
        .unwrap_or(false);

    Ok((exit_code, cancelled, timed_out))
}

async fn wait_for_pod(
    pods: &Api<k8s_openapi::api::core::v1::Pod>,
    job_name: &str,
) -> anyhow::Result<String> {
    let selector = format!("job-name={job_name}");
    let lp = ListParams::default().labels(&selector);
    let deadline = Instant::now() + Duration::from_secs(120);

    loop {
        if Instant::now() >= deadline {
            anyhow::bail!("timed out waiting for pod for job {job_name}");
        }
        let list = pods.list(&lp).await.context("list job pods")?;
        if let Some(pod) = list.items.first() {
            if let Some(name) = pod.metadata.name.clone() {
                return Ok(name);
            }
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
}