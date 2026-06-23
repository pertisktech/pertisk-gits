use std::path::Path;

use anyhow::Context;
use tokio::process::Command;

pub fn packet_line(data: &[u8]) -> Vec<u8> {
    let len = data.len() + 4;
    let mut out = format!("{len:04x}").into_bytes();
    out.extend_from_slice(data);
    out
}

pub fn packet_flush() -> &'static [u8] {
    b"0000"
}

pub fn wrap_service_advertisement(service: &str, body: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    out.extend_from_slice(&packet_line(format!("# service={service}\n").as_bytes()));
    out.extend_from_slice(packet_flush());
    out.extend_from_slice(body);
    out
}

pub async fn advertise_refs(repo_path: &Path, service: &str) -> anyhow::Result<Vec<u8>> {
    let subcommand = match service {
        "git-upload-pack" => "upload-pack",
        "git-receive-pack" => "receive-pack",
        other => anyhow::bail!("unsupported git service: {other}"),
    };

    let output = Command::new("git")
        .current_dir(repo_path)
        .args([subcommand, "--advertise-refs", "."])
        .output()
        .await
        .with_context(|| format!("git {subcommand} --advertise-refs"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("git advertise failed: {stderr}");
    }

    Ok(wrap_service_advertisement(service, &output.stdout))
}

pub async fn stateless_rpc(repo_path: &Path, service: &str, body: &[u8]) -> anyhow::Result<Vec<u8>> {
    let subcommand = match service {
        "git-upload-pack" => "upload-pack",
        "git-receive-pack" => "receive-pack",
        other => anyhow::bail!("unsupported git service: {other}"),
    };

    let mut child = Command::new("git")
        .current_dir(repo_path)
        .args([subcommand, "--stateless-rpc", "."])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .with_context(|| format!("spawn git {subcommand}"))?;

    if let Some(mut stdin) = child.stdin.take() {
        use tokio::io::AsyncWriteExt;
        stdin.write_all(body).await?;
    }

    let output = child.wait_with_output().await?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("git rpc failed: {stderr}");
    }

    Ok(output.stdout)
}
