use std::path::Path;

use anyhow::Context;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::process::Command;

use crate::command::GitService;
use crate::protocol;

pub async fn run_git_service(
    repo_path: &Path,
    service: GitService,
    stream: impl AsyncRead + AsyncWrite + Unpin + Send + 'static,
) -> anyhow::Result<()> {
    run_git_service_with_hints(repo_path, service, stream, None).await
}

pub async fn run_git_service_with_hints(
    repo_path: &Path,
    service: GitService,
    stream: impl AsyncRead + AsyncWrite + Unpin + Send + 'static,
    hint_lines: Option<Vec<String>>,
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
    let stdout_task = async {
        let mut stdout_buf = Vec::new();
        child_stdout.read_to_end(&mut stdout_buf).await?;
        if service == GitService::ReceivePack {
            if let Some(hints) = hint_lines {
                if !hints.is_empty() {
                    stdout_buf = protocol::append_receive_pack_sideband_messages(stdout_buf, &hints);
                }
            }
        }
        writer.write_all(&stdout_buf).await?;
        writer.flush().await?;
        Ok::<(), std::io::Error>(())
    };

    let (stdin_res, stdout_res) = tokio::join!(stdin_task, stdout_task);
    stdin_res.context("copy ssh stdin to git")?;
    stdout_res.context("copy git stdout to ssh")?;

    let status = child.wait().await.context("wait for git")?;
    if !status.success() {
        anyhow::bail!("git {subcommand} exited with {status}");
    }

    Ok(())
}
