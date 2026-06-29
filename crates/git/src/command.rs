use pertisk_domain::split_git_repo_path;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitSshCommand {
    pub service: GitService,
    pub org_path: String,
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
    let (org_path, repo_slug) = split_git_repo_path(path)?;

    Some(GitSshCommand {
        service,
        org_path: org_path.to_string(),
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
        assert_eq!(cmd.org_path, "acme");
        assert_eq!(cmd.repo_slug, "widget");
    }

    #[test]
    fn parses_nested_upload_pack() {
        let cmd = parse_ssh_command("git-upload-pack 'a/b/c/repo.git'").unwrap();
        assert_eq!(cmd.org_path, "a/b/c");
        assert_eq!(cmd.repo_slug, "repo");
    }
}
