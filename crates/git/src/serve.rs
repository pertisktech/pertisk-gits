use std::path::Path;

use anyhow::Context;
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::process::Command;

use crate::command::GitService;

pub async fn run_git_service(
    repo_path: &Path,
    service: GitService,
    stream: impl AsyncRead + AsyncWrite + Unpin + Send + 'static,
) -> anyhow::Result<()> {
    let subcommand = service.git_subcommand();

    let mut child = Command::new("git")
        .current_dir(repo_path)
        .arg(subcommand)
        .arg(".")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .with_context(|| format!("spawn git {subcommand}"))?;

    let mut child_stdin = child.stdin.take().context("git stdin")?;
    let mut child_stdout = child.stdout.take().context("git stdout")?;

    let (mut reader, mut writer) = tokio::io::split(stream);

    let stdin_task = tokio::io::copy(&mut reader, &mut child_stdin);
    let stdout_task = tokio::io::copy(&mut child_stdout, &mut writer);

    let (stdin_res, stdout_res) = tokio::join!(stdin_task, stdout_task);
    stdin_res.context("copy ssh stdin to git")?;
    stdout_res.context("copy git stdout to ssh")?;

    let status = child.wait().await.context("wait for git")?;
    if !status.success() {
        anyhow::bail!("git {subcommand} exited with {status}");
    }

    Ok(())
}
