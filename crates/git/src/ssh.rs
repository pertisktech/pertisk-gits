use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use anyhow::Context;
use russh::server::{Auth, Msg, Server as _, Session};
use russh::{Channel, ChannelId};
use sqlx::PgPool;
use tokio::sync::Mutex;

use crate::access::{self, AuthUser};
use crate::command::{parse_ssh_command, GitService};
use crate::config::repo_disk_path;
use crate::serve::run_git_service;
use crate::ssh_keys::fingerprint_of_key;
use crate::storage::ensure_bare_repo;

const GIT_USER: &str = "git";

#[derive(Clone)]
pub struct GitSshConfig {
    pub host: String,
    pub port: u16,
    pub host_key_path: PathBuf,
}

pub struct GitSshState {
    pub pool: PgPool,
    pub repos_root: PathBuf,
    pub config: GitSshConfig,
}

pub async fn run_server(state: Arc<GitSshState>) -> anyhow::Result<()> {
    let host_key = load_or_generate_host_key(&state.config.host_key_path)?;
    let config = Arc::new(russh::server::Config {
        inactivity_timeout: Some(Duration::from_secs(3600)),
        auth_rejection_time: Duration::from_secs(3),
        auth_rejection_time_initial: Some(Duration::from_secs(0)),
        keys: vec![host_key],
        ..Default::default()
    });

    let mut server = SshServer {
        state: state.clone(),
    };

    let addr = format!("{}:{}", state.config.host, state.config.port);
    tracing::info!("pertisk-git-ssh listening on {addr}");

    server
        .run_on_address(config, addr.parse::<SocketAddr>()?)
        .await
        .context("ssh server exited")?;

    Ok(())
}

fn load_or_generate_host_key(path: &Path) -> anyhow::Result<russh::keys::PrivateKey> {
    if !path.is_file() {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).with_context(|| format!("create {}", parent.display()))?;
        }

        let path_str = path
            .to_str()
            .context("ssh host key path is not valid UTF-8")?;
        let status = std::process::Command::new("ssh-keygen")
            .args(["-t", "ed25519", "-f", path_str, "-N", "", "-q"])
            .status()
            .context("spawn ssh-keygen")?;

        if !status.success() {
            anyhow::bail!("ssh-keygen failed with {status}");
        }

        tracing::info!("generated ssh host key at {}", path.display());
    }

    let pem = std::fs::read_to_string(path).with_context(|| format!("read {}", path.display()))?;
    russh::keys::PrivateKey::from_openssh(&pem).context("parse ssh host key")
}

#[derive(Clone)]
struct SshServer {
    state: Arc<GitSshState>,
}

impl russh::server::Server for SshServer {
    type Handler = SshSession;

    fn new_client(&mut self, _: Option<SocketAddr>) -> Self::Handler {
        SshSession::new(self.state.clone())
    }
}

struct SshSession {
    state: Arc<GitSshState>,
    user: Option<AuthUser>,
    channels: Arc<Mutex<HashMap<ChannelId, Channel<Msg>>>>,
}

impl SshSession {
    fn new(state: Arc<GitSshState>) -> Self {
        Self {
            state,
            user: None,
            channels: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    async fn take_channel(&self, id: ChannelId) -> Option<Channel<Msg>> {
        self.channels.lock().await.remove(&id)
    }
}

impl russh::server::Handler for SshSession {
    type Error = anyhow::Error;

    async fn auth_publickey(
        &mut self,
        user: &str,
        public_key: &russh::keys::ssh_key::PublicKey,
    ) -> Result<Auth, Self::Error> {
        if user != GIT_USER {
            return Ok(Auth::reject());
        }

        let fingerprint = fingerprint_of_key(public_key);
        let Some(auth_user) =
            crate::ssh_keys::find_user_by_fingerprint(&self.state.pool, &fingerprint).await?
        else {
            return Ok(Auth::reject());
        };

        self.user = Some(auth_user);
        Ok(Auth::Accept)
    }

    async fn channel_open_session(
        &mut self,
        channel: Channel<Msg>,
        _session: &mut Session,
    ) -> Result<bool, Self::Error> {
        self.channels.lock().await.insert(channel.id(), channel);
        Ok(true)
    }

    async fn exec_request(
        &mut self,
        channel_id: ChannelId,
        command: &[u8],
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        let Some(user) = self.user.clone() else {
            session.channel_failure(channel_id)?;
            return Ok(());
        };

        let command = std::str::from_utf8(command).context("git command is not utf-8")?;
        let Some(git_cmd) = parse_ssh_command(command) else {
            tracing::warn!("rejected ssh command: {command}");
            session.channel_failure(channel_id)?;
            return Ok(());
        };

        let repo = access::find_repo(
            &self.state.pool,
            &git_cmd.org_slug,
            &git_cmd.repo_slug,
        )
        .await?
        .ok_or_else(|| anyhow::anyhow!("repository not found"))?;

        let allowed = match git_cmd.service {
            GitService::UploadPack => {
                access::can_read_repo(&self.state.pool, &repo, Some(&user)).await?
            }
            GitService::ReceivePack => access::can_write_repo(&self.state.pool, &repo, &user).await?,
        };

        if !allowed {
            tracing::warn!(
                user = %user.username,
                repo = %format!("{}/{}", git_cmd.org_slug, git_cmd.repo_slug),
                "ssh git access denied"
            );
            session.channel_failure(channel_id)?;
            return Ok(());
        }

        ensure_bare_repo(
            &self.state.repos_root,
            &git_cmd.org_slug,
            &git_cmd.repo_slug,
        )
        .await?;

        let repo_path = repo_disk_path(
            &self.state.repos_root,
            &git_cmd.org_slug,
            &git_cmd.repo_slug,
        );

        let Some(channel) = self.take_channel(channel_id).await else {
            session.channel_failure(channel_id)?;
            return Ok(());
        };

        session.channel_success(channel_id)?;

        let service = git_cmd.service;
        tokio::spawn(async move {
            let stream = channel.into_stream();
            if let Err(err) = run_git_service(&repo_path, service, stream).await {
                tracing::error!(
                    repo = %repo_path.display(),
                    error = %err,
                    "git ssh service failed"
                );
            }
        });

        Ok(())
    }

    async fn shell_request(
        &mut self,
        channel_id: ChannelId,
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        session.channel_failure(channel_id)?;
        Ok(())
    }

    async fn subsystem_request(
        &mut self,
        channel_id: ChannelId,
        _name: &str,
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        session.channel_failure(channel_id)?;
        Ok(())
    }
}