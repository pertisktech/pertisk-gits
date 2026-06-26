mod common;
mod shell;

use std::path::Path;

use crate::api::{PollJobResponse, RunnerApi};

pub use common::{is_kubernetes_executor, prepare_secrets, runner_executor};

pub async fn run_job(
    api: &RunnerApi,
    job: PollJobResponse,
    repos_root: Option<&Path>,
) -> anyhow::Result<()> {
    if is_kubernetes_executor() {
        crate::k8s::run_job(api, job).await
    } else {
        shell::run_job(api, job, repos_root).await
    }
}
