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

/// Parse ref update commands from a `git-receive-pack --stateless-rpc` request body.
pub fn parse_receive_pack_commands(body: &[u8]) -> Vec<(String, String, String)> {
    let mut updates = Vec::new();
    let mut offset = 0usize;

    while offset + 4 <= body.len() {
        let len_hex = std::str::from_utf8(&body[offset..offset + 4]).unwrap_or("");
        let Ok(pkt_len) = usize::from_str_radix(len_hex, 16) else {
            break;
        };
        if pkt_len == 0 {
            break;
        }
        if pkt_len < 4 || offset + pkt_len > body.len() {
            break;
        }

        let payload = &body[offset + 4..offset + pkt_len];
        offset += pkt_len;

        if let Some(command) = parse_ref_command(payload) {
            updates.push(command);
        }
    }

    updates
}

fn parse_ref_command(payload: &[u8]) -> Option<(String, String, String)> {
    let nul = payload.iter().position(|&b| b == 0).unwrap_or(payload.len());
    let line = std::str::from_utf8(&payload[..nul]).ok()?;
    let mut parts = line.split_whitespace();
    let old_sha = parts.next()?;
    let new_sha = parts.next()?;
    let ref_name = parts.next()?;
    if old_sha.len() != 40 || new_sha.len() != 40 {
        return None;
    }
    Some((old_sha.to_string(), new_sha.to_string(), ref_name.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_receive_pack_commands() {
        let command = b"0000000000000000000000000000000000000000 1111111111111111111111111111111111111111 refs/heads/main\0";
        let pkt_len = 4 + command.len();
        let mut body = format!("{pkt_len:04x}").into_bytes();
        body.extend_from_slice(command);
        body.extend_from_slice(b"0000");

        let updates = parse_receive_pack_commands(&body);
        assert_eq!(updates.len(), 1);
        assert_eq!(updates[0].2, "refs/heads/main");
    }
}
