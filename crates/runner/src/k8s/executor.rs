use std::collections::{BTreeMap, HashMap};
use std::time::{Duration, Instant};

use anyhow::Context;
use chrono::Utc;
use k8s_openapi::api::batch::v1::Job;
use k8s_openapi::api::core::v1::{
    ConfigMap, ConfigMapVolumeSource, Container, EnvVar, PodSpec, PodTemplateSpec, SecurityContext,
    Volume, VolumeMount,
};
use k8s_openapi::apimachinery::pkg::apis::meta::v1::ObjectMeta;
use k8s_openapi::api::core::v1::Pod;
use k8s_openapi::apimachinery::pkg::apis::meta::v1::OwnerReference;
use kube::api::{DeleteParams, ListParams, LogParams, PostParams, PropagationPolicy};
use kube::{Api, Client};
use pertisk_cicd::apply_ci_config_to_step;
use pertisk_cicd::metrics::{JobMetrics, StepTiming};
use pertisk_cicd::render_job_script;
use tempfile::TempDir;
use uuid::Uuid;

use super::config::{job_resource_name, K8sExecutorConfig};
use crate::api::{PollJobResponse, RunnerApi};
use crate::job::{build_job_env, prepare_secrets};
use crate::log_stream::LogStreamer;

pub async fn run_job(api: &RunnerApi, job: PollJobResponse) -> anyhow::Result<()> {
    let config = K8sExecutorConfig::from_env();
    let client = Client::try_default()
        .await
        .context("connect to Kubernetes API (in-cluster or kubeconfig)")?;

    let job_name = job_resource_name(job.job_id);
    let script_cm_name = format!("{job_name}-script");

    let build_image = job
        .image
        .as_deref()
        .map(str::trim)
        .filter(|image| !image.is_empty())
        .unwrap_or(config.build_image.as_str());

    tracing::info!(
        job = %job.job_name,
        k8s_job = %job_name,
        namespace = %config.namespace,
        build_image = %build_image,
        dind = job.dind,
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
    let secrets = prepare_secrets(api, &job, work_root.path()).await?;

    let resolved_steps: Vec<_> = job
        .steps
        .iter()
        .map(|step| apply_ci_config_to_step(step, &secrets.secret_refs, &secrets.variable_refs))
        .collect();

    let mut extra_env: HashMap<String, String> =
        build_job_env(&secrets.injection, &config.workspace_mount_path)
            .into_iter()
            .collect();
    if job.dind {
        extra_env.insert("BUILDKIT_PROGRESS".into(), "plain".into());
        extra_env.insert("DOCKER_BUILDKIT".into(), "1".into());
    }

    let script = render_job_script(
        &config.workspace_mount_path,
        &resolved_steps,
        &job.artifacts,
        &extra_env,
    );

    let labels = job_labels(&config, &job_name, job.job_id);

    // Remove leftovers from a crashed prior attempt (same CI job id → same K8s names).
    cleanup_job_resources(&client, &config.namespace, &job_name, &script_cm_name).await;

    upsert_script_configmap(&client, &config.namespace, &script_cm_name, &script, &labels).await?;

    let k8s_job = build_job_spec(
        &config,
        &job_name,
        &script_cm_name,
        &labels,
        api,
        job.job_id,
        job.timeout_minutes,
        build_image,
        job.dind,
    );

    let jobs: Api<Job> = Api::namespaced(client.clone(), &config.namespace);
    if let Err(err) = jobs.create(&PostParams::default(), &k8s_job).await {
        let _ = delete_configmap(&client, &config.namespace, &script_cm_name).await;
        return Err(err).context("create Kubernetes Job");
    }

    let created_job = jobs
        .get(&job_name)
        .await
        .context("read created Kubernetes Job")?;
    if let Err(err) =
        attach_configmap_owner(&client, &config.namespace, &script_cm_name, &created_job).await
    {
        tracing::warn!(%err, cm = %script_cm_name, job = %job_name, "failed to set ConfigMap ownerReference");
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

    cleanup_job_resources(&client, &config.namespace, &job_name, &script_cm_name).await;

    let (exit_code, cancelled, timed_out, watch_err) = match result {
        Ok(values) => (values.0, values.1, values.2, None),
        Err(err) => (1, false, false, Some(err)),
    };

    if let Some(ref err) = watch_err {
        let _ = api
            .append_log(
                job.job_id,
                &format!("\n=== kubernetes job error: {err:#}\n"),
            )
            .await;
    }

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

    let status = if watch_err.is_some() || timed_out || exit_code != 0 {
        "failure"
    } else if cancelled {
        "cancelled"
    } else {
        "success"
    };

    let metrics_json = serde_json::to_value(&metrics).ok();
    api.complete_job(job.job_id, status, None, metrics_json).await?;
    tracing::info!(job = %job.job_name, status, k8s_job = %job_name, "kubernetes job finished");

    if let Some(err) = watch_err {
        return Err(err);
    }
    Ok(())
}

fn job_labels(
    config: &K8sExecutorConfig,
    job_name: &str,
    job_id: Uuid,
) -> BTreeMap<String, String> {
    let mut labels = BTreeMap::from([
        ("app.kubernetes.io/name".into(), "pertisk-ci-job".into()),
        ("app.kubernetes.io/component".into(), "pertisk-ci-job".into()),
        ("pertisk.dev/managed-by".into(), "pertisk-runner".into()),
        ("pertisk.dev/job-id".into(), job_id.to_string()),
        ("pertisk.dev/k8s-job".into(), job_name.into()),
    ]);
    if let Some(release) = &config.release_name {
        labels.insert("app.kubernetes.io/instance".into(), release.clone());
    }
    labels
}

async fn upsert_script_configmap(
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
    match cms.create(&PostParams::default(), &cm).await {
        Ok(_) => Ok(()),
        Err(kube::Error::Api(err)) if err.code == 409 => {
            cms.replace(name, &PostParams::default(), &cm)
                .await
                .context("replace script ConfigMap")?;
            Ok(())
        }
        Err(err) => Err(err).context("create script ConfigMap"),
    }
}

async fn attach_configmap_owner(
    client: &Client,
    namespace: &str,
    cm_name: &str,
    job: &Job,
) -> anyhow::Result<()> {
    let cms: Api<ConfigMap> = Api::namespaced(client.clone(), namespace);
    let mut cm = cms.get(cm_name).await.context("get script ConfigMap")?;
    let owner = OwnerReference {
        api_version: "batch/v1".into(),
        kind: "Job".into(),
        name: job
            .metadata
            .name
            .clone()
            .context("job metadata.name missing")?,
        uid: job.metadata.uid.clone().context("job metadata.uid missing")?,
        controller: Some(true),
        block_owner_deletion: Some(true),
    };
    cm.metadata.owner_references = Some(vec![owner]);
    cms.replace(cm_name, &PostParams::default(), &cm)
        .await
        .context("patch ConfigMap ownerReference")?;
    Ok(())
}

async fn cleanup_job_resources(
    client: &Client,
    namespace: &str,
    job_name: &str,
    script_cm_name: &str,
) {
    let jobs: Api<Job> = Api::namespaced(client.clone(), namespace);
    let pods: Api<Pod> = Api::namespaced(client.clone(), namespace);

    let delete_params = DeleteParams {
        propagation_policy: Some(PropagationPolicy::Foreground),
        ..Default::default()
    };
    if let Err(err) = jobs.delete(job_name, &delete_params).await {
        if !is_not_found(&err) {
            tracing::warn!(%err, job = %job_name, "failed to delete Kubernetes Job during cleanup");
        }
    }

    if let Err(err) =
        wait_for_job_pods_gone(&pods, job_name, Duration::from_secs(120)).await
    {
        tracing::warn!(%err, job = %job_name, "timed out waiting for job pods to terminate");
    }

    if let Err(err) = delete_configmap(client, namespace, script_cm_name).await {
        tracing::warn!(%err, cm = %script_cm_name, "failed to delete script ConfigMap during cleanup");
    }
}

fn is_not_found(err: &kube::Error) -> bool {
    matches!(err, kube::Error::Api(api) if api.code == 404)
}

async fn wait_for_job_pods_gone(
    pods: &Api<Pod>,
    job_name: &str,
    timeout: Duration,
) -> anyhow::Result<()> {
    let selector = format!("job-name={job_name}");
    let lp = ListParams::default().labels(&selector);
    let deadline = Instant::now() + timeout;

    loop {
        let list = pods.list(&lp).await.context("list job pods during cleanup")?;
        if list.items.is_empty() {
            return Ok(());
        }
        if Instant::now() >= deadline {
            anyhow::bail!("timed out waiting for pods of job {job_name} to terminate");
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
}

async fn delete_configmap(client: &Client, namespace: &str, name: &str) -> anyhow::Result<()> {
    let cms: Api<ConfigMap> = Api::namespaced(client.clone(), namespace);
    match cms.delete(name, &DeleteParams::default()).await {
        Ok(_) => Ok(()),
        Err(kube::Error::Api(err)) if err.code == 404 => Ok(()),
        Err(err) => Err(err).context("delete script ConfigMap"),
    }
}

fn build_job_spec(
    config: &K8sExecutorConfig,
    job_name: &str,
    script_cm_name: &str,
    labels: &BTreeMap<String, String>,
    api: &RunnerApi,
    job_id: Uuid,
    timeout_minutes: Option<u32>,
    build_image: &str,
    dind: bool,
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
        env_var("CARGO_TARGET_DIR", &format!("{workspace}/target")),
        env_var("GOCACHE", "/tmp/go-cache"),
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

    let build_env = common_env;
    let mut build_command = vec!["/bin/sh".into(), "-c".into()];
    let mut build_args = Some(vec![EXEC_JOB_SCRIPT.to_string()]);
    let mut build_mounts = vec![
        VolumeMount {
            name: "workspace".into(),
            mount_path: workspace.clone(),
            ..Default::default()
        },
        VolumeMount {
            name: "scripts".into(),
            mount_path: "/scripts".into(),
            read_only: Some(true),
            ..Default::default()
        },
    ];

    if dind {
        build_mounts.push(VolumeMount {
            name: "docker-sock".into(),
            mount_path: "/var/run".into(),
            ..Default::default()
        });
        build_command = vec!["/bin/sh".into(), "-c".into()];
        build_args = Some(vec![format!(
            "{WAIT_FOR_DIND_SCRIPT}\n{EXEC_JOB_SCRIPT}"
        )]);
    }

    let build = Container {
        name: "build".into(),
        image: Some(build_image.to_string()),
        command: Some(build_command),
        args: build_args,
        env: Some(build_env),
        volume_mounts: Some(build_mounts),
        ..Default::default()
    };

    let mut containers = Vec::new();
    if dind {
        containers.push(Container {
            name: "dind".into(),
            image: Some(config.dind_image.clone()),
            command: Some(vec!["dockerd".into()]),
            args: Some(vec![
                "--host=unix:///var/run/docker.sock".into(),
                "--storage-driver=overlay2".into(),
            ]),
            security_context: Some(SecurityContext {
                privileged: Some(true),
                ..Default::default()
            }),
            env: Some(vec![env_var("DOCKER_TLS_CERTDIR", "")]),
            volume_mounts: Some(vec![VolumeMount {
                name: "docker-sock".into(),
                mount_path: "/var/run".into(),
                ..Default::default()
            }]),
            ..Default::default()
        });
    }
    containers.push(build);

    let mut pod_labels = labels.clone();
    pod_labels.insert("job-name".into(), job_name.into());

    let mut volumes = vec![
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
    ];
    if dind {
        volumes.push(Volume {
            name: "docker-sock".into(),
            empty_dir: Some(Default::default()),
            ..Default::default()
        });
    }

    let mut spec = PodSpec {
        restart_policy: Some("Never".into()),
        init_containers: Some(vec![helper]),
        containers,
        volumes: Some(volumes),
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

/// Line-buffer job script output so Kubernetes log polling streams lines during long steps.
const EXEC_JOB_SCRIPT: &str = r#"set -eu
if command -v apk >/dev/null 2>&1; then
  apk add --no-cache coreutils >/dev/null 2>&1 || true
fi
if command -v stdbuf >/dev/null 2>&1; then
  exec stdbuf -oL -eL /bin/sh /scripts/run.sh
fi
exec /bin/sh /scripts/run.sh
"#;

const WAIT_FOR_DIND_SCRIPT: &str = r#"set -eu
echo "=== waiting for docker daemon"
i=0
while [ "$i" -lt 90 ]; do
  if docker info >/dev/null 2>&1; then
    echo "=== docker daemon ready"
    break
  fi
  i=$((i + 1))
  sleep 1
done
docker info >/dev/null
"#;

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

    let pod_name = wait_for_build_ready(&pods, job_name, api, job_id).await?;

    if let Some(init_exit) = helper_init_exit_code(&pods, &pod_name).await? {
        if init_exit != 0 {
            let helper_log = fetch_container_log(&pods, &pod_name, "helper").await;
            if !helper_log.is_empty() {
                api.append_log(job_id, &helper_log).await?;
            }
            api.append_log(
                job_id,
                &format!("\n=== helper init container failed (exit {init_exit})\n"),
            )
            .await?;
            return Ok((init_exit, false, false));
        }
    }

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
    let (exit_code, timed_out) =
        follow_build_logs_until_exit(
            &pods,
            &jobs,
            job_name,
            &pod_name,
            &mut streamer,
            timeout_minutes,
        )
        .await?;

    cancel_handle.abort();

    if exit_code != 0 {
        append_container_logs_on_failure(&pods, &pod_name, api, job_id).await;
    }

    if timed_out {
        api.append_log(
            job_id,
            &format!(
                "\n=== job timed out after {} minutes\n",
                timeout_minutes.unwrap_or(0)
            ),
        )
        .await?;
    }

    let cancelled = api
        .fetch_job_control(job_id)
        .await
        .map(|c| c.should_cancel_job())
        .unwrap_or(false);

    Ok((exit_code, cancelled, timed_out))
}

async fn follow_build_logs_until_exit<'a>(
    pods: &Api<Pod>,
    jobs: &Api<Job>,
    job_name: &str,
    pod_name: &str,
    streamer: &mut LogStreamer<'a>,
    timeout_minutes: Option<u32>,
) -> anyhow::Result<(i32, bool)> {
    let max_wait = timeout_minutes
        .map(|minutes| Duration::from_secs(minutes as u64 * 60))
        .unwrap_or(Duration::from_secs(3600));
    let deadline = Instant::now() + max_wait + Duration::from_secs(120);
    let mut sent_bytes = 0usize;
    let mut timed_out = false;

    loop {
        if Instant::now() >= deadline {
            anyhow::bail!("timed out waiting for build container exit for job {job_name}");
        }

        push_build_log_delta(pods, pod_name, streamer, &mut sent_bytes).await;

        if let Some(exit_code) = build_container_exit_code(pods, pod_name).await? {
            push_build_log_delta(pods, pod_name, streamer, &mut sent_bytes).await;
            streamer.flush().await;
            return Ok((exit_code, timed_out));
        }

        if let Ok(job) = jobs.get(job_name).await {
            if let Some(status) = &job.status {
                if status.conditions.as_ref().is_some_and(|conds| {
                    conds.iter().any(|c| {
                        c.type_ == "Failed" && c.reason.as_deref() == Some("DeadlineExceeded")
                    })
                }) {
                    timed_out = true;
                }
                if status.succeeded.is_some_and(|n| n > 0) {
                    push_build_log_delta(pods, pod_name, streamer, &mut sent_bytes).await;
                    streamer.flush().await;
                    if let Some(exit_code) = build_container_exit_code(pods, pod_name).await? {
                        return Ok((exit_code, timed_out));
                    }
                    return Ok((0, timed_out));
                }
                if status.failed.is_some_and(|n| n > 0) {
                    push_build_log_delta(pods, pod_name, streamer, &mut sent_bytes).await;
                    streamer.flush().await;
                    if let Some(exit_code) = build_container_exit_code(pods, pod_name).await? {
                        return Ok((exit_code, timed_out));
                    }
                    return Ok((1, timed_out));
                }
            }
        }

        if let Ok(pod) = pods.get(pod_name).await {
            let phase = pod
                .status
                .as_ref()
                .and_then(|status| status.phase.as_deref());
            if matches!(phase, Some("Failed") | Some("Succeeded")) {
                push_build_log_delta(pods, pod_name, streamer, &mut sent_bytes).await;
                streamer.flush().await;
                if let Some(exit_code) = build_container_exit_code(pods, pod_name).await? {
                    return Ok((exit_code, timed_out));
                }
                let phase_exit = if phase == Some("Succeeded") { 0 } else { 1 };
                return Ok((phase_exit, timed_out));
            }
        }

        tokio::time::sleep(Duration::from_millis(500)).await;
    }
}

async fn push_build_log_delta<'a>(
    pods: &Api<Pod>,
    pod_name: &str,
    streamer: &mut LogStreamer<'a>,
    sent_bytes: &mut usize,
) {
    let full = fetch_container_log(pods, pod_name, "build").await;
    if full.len() < *sent_bytes {
        // Container log rotated or truncated — resync from the start.
        *sent_bytes = 0;
    }
    if full.len() > *sent_bytes {
        streamer.push(&full[*sent_bytes..]).await;
        *sent_bytes = full.len();
        streamer.flush().await;
    }
}

async fn build_container_exit_code(
    pods: &Api<Pod>,
    pod_name: &str,
) -> anyhow::Result<Option<i32>> {
    let pod = pods.get(pod_name).await.context("read job pod for exit code")?;
    Ok(pod
        .status
        .and_then(|status| status.container_statuses)
        .and_then(|statuses| statuses.into_iter().find(|c| c.name == "build"))
        .and_then(|c| c.state)
        .and_then(|state| state.terminated)
        .map(|terminated| terminated.exit_code))
}

async fn wait_for_build_ready(
    pods: &Api<Pod>,
    job_name: &str,
    api: &RunnerApi,
    job_id: Uuid,
) -> anyhow::Result<String> {
    let selector = format!("job-name={job_name}");
    let lp = ListParams::default().labels(&selector);
    let deadline = Instant::now() + Duration::from_secs(300);
    let mut last_helper_log_at = Instant::now();

    loop {
        if Instant::now() >= deadline {
            anyhow::bail!("timed out waiting for build container to start for job {job_name}");
        }
        let list = pods.list(&lp).await.context("list job pods")?;
        if let Some(pod) = list.items.first() {
            if let Some(name) = pod.metadata.name.clone() {
                if helper_init_running(pod) && last_helper_log_at.elapsed() >= Duration::from_secs(5)
                {
                    let helper_log = fetch_container_log(pods, &name, "helper").await;
                    if !helper_log.is_empty() {
                        let _ = api.append_log(job_id, &helper_log).await;
                    }
                    last_helper_log_at = Instant::now();
                }
                if pod_ready_for_build_logs(pod) {
                    return Ok(name);
                }
            }
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
}

fn helper_init_running(pod: &Pod) -> bool {
    pod.status
        .as_ref()
        .and_then(|s| s.init_container_statuses.as_ref())
        .and_then(|statuses| statuses.iter().find(|c| c.name == "helper"))
        .and_then(|c| c.state.as_ref())
        .and_then(|s| s.running.as_ref())
        .is_some()
}

fn pod_ready_for_build_logs(pod: &Pod) -> bool {
    let Some(status) = &pod.status else {
        return false;
    };

    if status.phase.as_deref() == Some("Failed") {
        return true;
    }

    let helper = status
        .init_container_statuses
        .as_ref()
        .and_then(|statuses| statuses.iter().find(|c| c.name == "helper"))
        .and_then(|c| c.state.as_ref());

    let Some(helper_state) = helper else {
        return false;
    };

    if helper_state.running.is_some() || helper_state.waiting.is_some() {
        return false;
    }

    let Some(helper_term) = helper_state.terminated.as_ref() else {
        return false;
    };

    if helper_term.exit_code != 0 {
        return true;
    }

    let Some(build) = status
        .container_statuses
        .as_ref()
        .and_then(|statuses| statuses.iter().find(|c| c.name == "build"))
        .and_then(|c| c.state.as_ref())
    else {
        return false;
    };

    build.running.is_some()
        || build.terminated.is_some()
        || build.waiting.as_ref().is_some_and(|w| {
            w.reason.as_deref() != Some("PodInitializing")
        })
}

async fn helper_init_exit_code(pods: &Api<Pod>, pod_name: &str) -> anyhow::Result<Option<i32>> {
    let pod = pods.get(pod_name).await.context("read job pod")?;
    Ok(pod
        .status
        .and_then(|s| s.init_container_statuses)
        .and_then(|statuses| statuses.into_iter().find(|c| c.name == "helper"))
        .and_then(|c| c.state)
        .and_then(|s| s.terminated)
        .map(|t| t.exit_code))
}

async fn append_container_logs_on_failure(
    pods: &Api<Pod>,
    pod_name: &str,
    api: &RunnerApi,
    job_id: Uuid,
) {
    for container in ["build", "dind"] {
        let log = fetch_container_log(pods, pod_name, container).await;
        if log.trim().is_empty() {
            continue;
        }
        let _ = api
            .append_log(
                job_id,
                &format!("\n=== {container} container log ===\n{log}\n"),
            )
            .await;
    }
}

async fn fetch_container_log(pods: &Api<Pod>, pod_name: &str, container: &str) -> String {
    let params = LogParams {
        container: Some(container.into()),
        ..Default::default()
    };
    match pods.logs(pod_name, &params).await {
        Ok(log) => log,
        Err(err) => {
            tracing::warn!(%err, pod = %pod_name, %container, "failed to fetch container log");
            String::new()
        }
    }
}