#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitSshCommand {
    pub service: GitService,
    pub org_slug: String,
    pub repo_slug: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GitService {
    UploadPack,
    ReceivePack,
}

impl GitService {
    pub fn git_subcommand(self) -> &'static str {
        match self {
            GitService::UploadPack => "upload-pack",
            GitService::ReceivePack => "receive-pack",
        }
    }
}

/// Parse commands sent by `git` over SSH, e.g. `git-upload-pack 'org/repo.git'`.
pub fn parse_ssh_command(command: &str) -> Option<GitSshCommand> {
    let command = command.trim();
    if command.is_empty() {
        return None;
    }

    let (service, rest) = if let Some(rest) = command.strip_prefix("git-upload-pack") {
        (GitService::UploadPack, rest)
    } else if let Some(rest) = command.strip_prefix("git-receive-pack") {
        (GitService::ReceivePack, rest)
    } else if let Some(rest) = command.strip_prefix("git upload-pack") {
        (GitService::UploadPack, rest)
    } else if let Some(rest) = command.strip_prefix("git receive-pack") {
        (GitService::ReceivePack, rest)
    } else {
        return None;
    };

    let path = rest
        .trim()
        .trim_matches('\'')
        .trim_matches('"')
        .trim();
    let path = path.trim_start_matches('/');
    let path = path.strip_suffix(".git").unwrap_or(path);

    let (org_slug, repo_slug) = path.split_once('/')?;

    if org_slug.is_empty() || repo_slug.is_empty() {
        return None;
    }

    Some(GitSshCommand {
        service,
        org_slug: org_slug.to_string(),
        repo_slug: repo_slug.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_upload_pack() {
        let cmd = parse_ssh_command("git-upload-pack 'acme/widget.git'").unwrap();
        assert_eq!(cmd.service, GitService::UploadPack);
        assert_eq!(cmd.org_slug, "acme");
        assert_eq!(cmd.repo_slug, "widget");
    }

    #[test]
    fn parses_receive_pack_spaced() {
        let cmd = parse_ssh_command("git receive-pack 'acme/widget.git'").unwrap();
        assert_eq!(cmd.service, GitService::ReceivePack);
    }
}
