use std::path::{Path, PathBuf};
use std::sync::Arc;

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use pertisk_domain::models::{ImportOnConflict, ImportProvider, OrgRole, RepoVisibility};
use pertisk_domain::org_groups::{ensure_org_chain, import_target_org_path};
use pertisk_git::config::repo_disk_path;
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use tokio::process::Command;
use uuid::Uuid;

const NONCE_LEN: usize = 12;
/// Re-claim stuck import work after a pod crash (HA / shared storage).
const IMPORT_STALE_MINUTES: i32 = 30;

pub struct ImportWorker {
    pub pool: PgPool,
    pub repos_root: Arc<PathBuf>,
    pub secrets_key: [u8; 32],
}

impl ImportWorker {
    pub fn from_env(pool: PgPool, repos_root: Arc<PathBuf>) -> anyhow::Result<Self> {
        let secrets_key = load_secrets_key()?;
        Ok(Self {
            pool,
            repos_root,
            secrets_key,
        })
    }

    pub async fn process_pending_jobs(&self) -> anyhow::Result<u32> {
        let jobs = sqlx::query_as::<_, JobRow>(
            r#"
            UPDATE import_jobs j
            SET status = 'mirroring',
                started_at = COALESCE(j.started_at, NOW()),
                updated_at = NOW()
            FROM (
                SELECT id
                FROM import_jobs
                WHERE status = 'pending'
                   OR (
                     status IN ('mirroring', 'metadata')
                     AND updated_at < NOW() - make_interval(mins => $1)
                   )
                ORDER BY created_at ASC
                LIMIT 5
                FOR UPDATE SKIP LOCKED
            ) picked
            WHERE j.id = picked.id
            RETURNING j.id, j.organization_id, j.created_by, j.credential_id, j.provider::text,
                j.import_issues, j.import_pull_requests, j.import_wiki, j.on_conflict
            "#,
        )
        .bind(IMPORT_STALE_MINUTES)
        .fetch_all(&self.pool)
        .await?;

        let mut processed = 0u32;
        for job in jobs {
            if let Err(err) = self.process_job(job).await {
                tracing::warn!("import job failed: {err:#}");
            }
            processed += 1;
        }
        Ok(processed)
    }

    async fn process_job(&self, job: JobRow) -> anyhow::Result<()> {
        let (provider, token, base_url) = self.load_credential(job.credential_id).await?;
        let org_full_path = self.org_full_path(job.organization_id).await?;

        let repos = sqlx::query_as::<_, RepoRow>(
            r#"
            SELECT
                id, source_full_name, source_clone_url, target_slug, target_name,
                description, visibility::text, default_branch, repository_id, status::text
            FROM import_job_repos
            WHERE job_id = $1 AND status IN ('pending', 'mirroring', 'metadata')
            ORDER BY source_full_name
            "#,
        )
        .bind(job.id)
        .fetch_all(&self.pool)
        .await?;

        let mut failures = 0usize;
        let repo_count = repos.len();
        for repo in repos {
            if let Err(err) = self
                .import_repo(
                    &job,
                    &org_full_path,
                    provider,
                    &token,
                    &base_url,
                    &repo,
                )
                .await
            {
                failures += 1;
                let message = err.to_string();
                tracing::warn!(
                    job = %job.id,
                    repo = %repo.source_full_name,
                    "import repo failed: {message}"
                );
                sqlx::query(
                    r#"
                    UPDATE import_job_repos
                    SET status = 'failed', error_message = $2, updated_at = NOW()
                    WHERE id = $1
                    "#,
                )
                .bind(repo.id)
                .bind(&message)
                .execute(&self.pool)
                .await?;
            }
        }

        let final_status = import_job_final_status(failures, repo_count);

        sqlx::query(
            r#"
            UPDATE import_jobs
            SET status = $2::import_job_status,
                finished_at = NOW(),
                error_message = CASE WHEN $3 > 0 THEN format('%s repositories failed', $3) ELSE NULL END,
                updated_at = NOW()
            WHERE id = $1
            "#,
        )
        .bind(job.id)
        .bind(final_status)
        .bind(failures as i32)
        .execute(&self.pool)
        .await?;

        let _ = sqlx::query(
            r#"
            INSERT INTO audit_events (
                organization_id, actor_user_id, event_type, action,
                resource_type, resource_id, metadata
            )
            VALUES ($1, $2, 'import', $3, 'import_job', $4, $5)
            "#,
        )
        .bind(job.organization_id)
        .bind(job.created_by)
        .bind(if failures > 0 {
            format!("import job finished with {failures} failures")
        } else {
            "import job finished".into()
        })
        .bind(job.id.to_string())
        .bind(serde_json::json!({ "failures": failures }))
        .execute(&self.pool)
        .await;

        Ok(())
    }

    async fn import_repo(
        &self,
        job: &JobRow,
        target_org_full_path: &str,
        provider: ImportProvider,
        token: &str,
        base_url: &str,
        repo: &RepoRow,
    ) -> anyhow::Result<()> {
        let visibility = match repo.visibility.as_str() {
            "public" => RepoVisibility::Public,
            _ => RepoVisibility::Private,
        };

        let target_org_path =
            import_target_org_path(target_org_full_path, &repo.source_full_name);
        let target_org_id =
            ensure_org_chain(&self.pool, &target_org_path, job.created_by).await?;

        let existing_repo_id = self
            .find_repository_id(target_org_id, &repo.target_slug)
            .await?;

        let repository_id = match (repo.repository_id, existing_repo_id) {
            (Some(id), _) => id,
            (None, Some(id)) if job.on_conflict == ImportOnConflict::Skip => {
                sqlx::query(
                    r#"
                    UPDATE import_job_repos
                    SET status = 'skipped', repository_id = $2, updated_at = NOW()
                    WHERE id = $1
                    "#,
                )
                .bind(repo.id)
                .bind(id)
                .execute(&self.pool)
                .await?;
                return Ok(());
            }
            (None, Some(id)) => id,
            (None, None) => {
                self.ensure_repository(
                    target_org_id,
                    job.created_by,
                    &repo.target_slug,
                    &repo.target_name,
                    repo.description.as_deref(),
                    visibility,
                )
                .await?
            }
        };

        let mut default_branch = if repo.status == "metadata" {
            sqlx::query_scalar::<_, String>(
                "SELECT default_branch FROM repositories WHERE id = $1",
            )
            .bind(repository_id)
            .fetch_optional(&self.pool)
            .await?
            .or_else(|| repo.default_branch.clone())
            .unwrap_or_else(|| "main".into())
        } else {
            repo.default_branch
                .clone()
                .unwrap_or_else(|| "main".into())
        };

        if repo.status == "pending" || repo.status == "mirroring" {
            if !self
                .try_claim_repo_mirror(repo.id, repository_id)
                .await?
            {
                tracing::debug!(
                    job = %job.id,
                    repo = %repo.source_full_name,
                    "import repo skipped — claimed by another worker"
                );
                return Ok(());
            }

            let repo_path = repo_disk_path(&self.repos_root, &target_org_path, &repo.target_slug);
            let auth_url = authenticated_clone_url(provider, &repo.source_clone_url, token)?;
            mirror_repository(&auth_url, &repo_path).await?;

            default_branch = read_default_branch(&repo_path)
                .await
                .or_else(|| repo.default_branch.clone())
                .unwrap_or_else(|| "main".into());

            sqlx::query(
                r#"
                UPDATE repositories
                SET default_branch = $2, updated_at = NOW()
                WHERE id = $1
                "#,
            )
            .bind(repository_id)
            .bind(&default_branch)
            .execute(&self.pool)
            .await?;
        }

        if job.import_issues || job.import_pull_requests || job.import_wiki {
            if repo.status != "metadata" {
                sqlx::query(
                    r#"
                    UPDATE import_job_repos
                    SET status = 'metadata', updated_at = NOW()
                    WHERE id = $1
                    "#,
                )
                .bind(repo.id)
                .execute(&self.pool)
                .await?;
            }

            if job.import_issues || job.import_pull_requests {
                match crate::metadata::import_repo_metadata(
                    &self.pool,
                    provider,
                    token,
                    base_url,
                    &repo.source_full_name,
                    repository_id,
                    job.created_by,
                    crate::metadata::MetadataImportOptions {
                        import_issues: job.import_issues,
                        import_pull_requests: job.import_pull_requests,
                    },
                )
                .await
                {
                    Ok(stats) => tracing::info!(
                        repo = %repo.source_full_name,
                        labels = stats.labels,
                        milestones = stats.milestones,
                        issues = stats.issues,
                        pull_requests = stats.pull_requests,
                        "imported repository metadata"
                    ),
                    Err(err) => tracing::warn!(
                        repo = %repo.source_full_name,
                        "metadata import failed: {err:#}"
                    ),
                }
            }

            if job.import_wiki {
                match crate::wiki_import::import_repo_wiki(
                    &self.pool,
                    provider,
                    token,
                    base_url,
                    &repo.source_full_name,
                    &repo.source_clone_url,
                    repository_id,
                    job.created_by,
                )
                .await
                {
                    Ok(pages) => tracing::info!(
                        repo = %repo.source_full_name,
                        pages,
                        "imported wiki pages"
                    ),
                    Err(err) => tracing::warn!(
                        repo = %repo.source_full_name,
                        "wiki import failed: {err:#}"
                    ),
                }
            }
        }

        sqlx::query(
            r#"
            UPDATE import_job_repos
            SET status = 'done', default_branch = $2, updated_at = NOW()
            WHERE id = $1
            "#,
        )
        .bind(repo.id)
        .bind(&default_branch)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    async fn ensure_repository(
        &self,
        org_id: Uuid,
        user_id: Uuid,
        slug: &str,
        name: &str,
        description: Option<&str>,
        visibility: RepoVisibility,
    ) -> anyhow::Result<Uuid> {
        if let Some(existing) = sqlx::query_scalar::<_, Uuid>(
            r#"
            SELECT id FROM repositories
            WHERE organization_id = $1 AND slug = $2
            "#,
        )
        .bind(org_id)
        .bind(slug)
        .fetch_optional(&self.pool)
        .await?
        {
            return Ok(existing);
        }

        let mut tx = self.pool.begin().await?;
        let repo_id = sqlx::query_scalar::<_, Uuid>(
            r#"
            INSERT INTO repositories (organization_id, name, slug, description, visibility)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id
            "#,
        )
        .bind(org_id)
        .bind(name)
        .bind(slug)
        .bind(description)
        .bind(visibility)
        .fetch_one(&mut *tx)
        .await?;

        sqlx::query(
            r#"
            INSERT INTO repository_permissions (repository_id, user_id, role)
            VALUES ($1, $2, 'admin')
            ON CONFLICT (repository_id, user_id) DO NOTHING
            "#,
        )
        .bind(repo_id)
        .bind(user_id)
        .execute(&mut *tx)
        .await?;

        sqlx::query(
            r#"
            INSERT INTO repository_counters (repository_id)
            VALUES ($1)
            ON CONFLICT (repository_id) DO NOTHING
            "#,
        )
        .bind(repo_id)
        .execute(&mut *tx)
        .await?;

        let org_role = sqlx::query_scalar::<_, OrgRole>(
            r#"
            SELECT role FROM organization_members
            WHERE organization_id = $1 AND user_id = $2
            "#,
        )
        .bind(org_id)
        .bind(user_id)
        .fetch_optional(&mut *tx)
        .await?;

        if !matches!(org_role, Some(OrgRole::Owner) | Some(OrgRole::Admin)) {
            sqlx::query(
                r#"
                INSERT INTO organization_members (organization_id, user_id, role)
                VALUES ($1, $2, 'member')
                ON CONFLICT DO NOTHING
                "#,
            )
            .bind(org_id)
            .bind(user_id)
            .execute(&mut *tx)
            .await?;
        }

        tx.commit().await?;
        Ok(repo_id)
    }

    async fn find_repository_id(
        &self,
        org_id: Uuid,
        slug: &str,
    ) -> anyhow::Result<Option<Uuid>> {
        Ok(sqlx::query_scalar::<_, Uuid>(
            r#"
            SELECT id FROM repositories
            WHERE organization_id = $1 AND slug = $2
            "#,
        )
        .bind(org_id)
        .bind(slug)
        .fetch_optional(&self.pool)
        .await?)
    }

    async fn org_full_path(&self, org_id: Uuid) -> anyhow::Result<String> {
        Ok(sqlx::query_scalar::<_, String>(
            "SELECT full_path FROM organizations WHERE id = $1",
        )
        .bind(org_id)
        .fetch_one(&self.pool)
        .await?)
    }

    async fn load_credential(
        &self,
        credential_id: Uuid,
    ) -> anyhow::Result<(ImportProvider, String, String)> {
        let row = sqlx::query_as::<_, (String, Vec<u8>, Option<String>)>(
            r#"
            SELECT provider::text, encrypted_token, base_url
            FROM import_credentials
            WHERE id = $1
            "#,
        )
        .bind(credential_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| anyhow::anyhow!("import credential not found"))?;

        let provider = match row.0.as_str() {
            "github" => ImportProvider::Github,
            "gitlab" => ImportProvider::Gitlab,
            "pertisk" => ImportProvider::Pertisk,
            other => anyhow::bail!("unknown provider {other}"),
        };
        let token = decrypt_secret(&self.secrets_key, &row.1)?;
        let base_url = row
            .2
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| match provider {
                ImportProvider::Github => "https://github.com".into(),
                ImportProvider::Gitlab => "https://gitlab.com".into(),
                ImportProvider::Pertisk => String::new(),
            });
        Ok((provider, token, base_url))
    }

    async fn try_claim_repo_mirror(&self, repo_id: Uuid, repository_id: Uuid) -> anyhow::Result<bool> {
        let result = sqlx::query(
            r#"
            UPDATE import_job_repos
            SET repository_id = COALESCE(repository_id, $2),
                status = 'mirroring',
                updated_at = NOW()
            WHERE id = $1
              AND (
                status = 'pending'
                OR (
                  status = 'mirroring'
                  AND updated_at < NOW() - make_interval(mins => $3)
                )
              )
            "#,
        )
        .bind(repo_id)
        .bind(repository_id)
        .bind(IMPORT_STALE_MINUTES)
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() > 0)
    }
}

async fn mirror_repository(auth_url: &str, repo_path: &Path) -> anyhow::Result<()> {
    if let Some(parent) = repo_path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }

    if repo_path.join("HEAD").exists() {
        let repo = repo_path.to_str().unwrap_or_default();
        if git_has_remote(repo, "origin").await? {
            git_run(&["-C", repo, "remote", "set-url", "origin", auth_url], "git remote set-url")
                .await?;
        } else {
            git_run(&["-C", repo, "remote", "add", "origin", auth_url], "git remote add")
                .await?;
        }

        git_run(
            &["-C", repo, "remote", "update", "--prune"],
            "git remote update",
        )
        .await?;
        return Ok(());
    }

    let tmp_path = repo_path.with_extension("import-tmp");
    if tmp_path.exists() {
        remove_repo_dir(&tmp_path).await?;
    }

    git_run(
        &[
            "clone",
            "--mirror",
            auth_url,
            tmp_path.to_str().unwrap_or_default(),
        ],
        "git clone --mirror",
    )
    .await?;

    if repo_path.exists() {
        remove_repo_dir(repo_path).await?;
    }

    tokio::fs::rename(&tmp_path, repo_path).await?;
    Ok(())
}

async fn remove_repo_dir(path: &Path) -> anyhow::Result<()> {
    match tokio::fs::remove_dir_all(path).await {
        Ok(()) => Ok(()),
        Err(err) if err.raw_os_error() == Some(39) => {
            // NFS or concurrent import left a non-empty partial directory — retry once.
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            tokio::fs::remove_dir_all(path).await?;
            Ok(())
        }
        Err(err) => Err(err.into()),
    }
}

async fn git_has_remote(repo_path: &str, name: &str) -> anyhow::Result<bool> {
    let output = Command::new("git")
        .args(["-C", repo_path, "remote", "get-url", name])
        .output()
        .await?;
    Ok(output.status.success())
}

async fn git_run(args: &[&str], label: &str) -> anyhow::Result<()> {
    let output = Command::new("git").args(args).output().await?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if stderr.is_empty() {
        anyhow::bail!("{label} failed");
    }
    anyhow::bail!("{label} failed: {stderr}");
}

async fn read_default_branch(repo_path: &Path) -> Option<String> {
    let output = Command::new("git")
        .args([
            "-C",
            repo_path.to_str()?,
            "symbolic-ref",
            "HEAD",
        ])
        .output()
        .await
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let value = String::from_utf8_lossy(&output.stdout);
    parse_default_branch(&value)
}

fn parse_default_branch(stdout: &str) -> Option<String> {
    let value = stdout.trim().to_string();
    if value.is_empty() {
        return None;
    }
    value
        .strip_prefix("refs/heads/")
        .map(str::to_string)
        .or(Some(value))
}

fn import_job_final_status(failures: usize, repo_count: usize) -> &'static str {
    if failures > 0 && failures == repo_count {
        "failed"
    } else {
        "done"
    }
}

fn authenticated_clone_url(
    provider: ImportProvider,
    clone_url: &str,
    token: &str,
) -> anyhow::Result<String> {
    let scheme_end = clone_url
        .find("://")
        .map(|index| index + 3)
        .ok_or_else(|| anyhow::anyhow!("invalid clone URL"))?;
    let (scheme, rest) = clone_url.split_at(scheme_end);
    if rest.contains('@') {
        anyhow::bail!("clone URL already contains credentials");
    }
    let username = match provider {
        ImportProvider::Github | ImportProvider::Pertisk => "x-access-token",
        ImportProvider::Gitlab => "oauth2",
    };
    Ok(format!("{scheme}{username}:{token}@{rest}"))
}

fn load_secrets_key() -> anyhow::Result<[u8; 32]> {
    if let Ok(raw) = std::env::var("SECRETS_ENCRYPTION_KEY") {
        return decode_key(&raw);
    }
    if let Ok(jwt) = std::env::var("JWT_SECRET") {
        return Ok(Sha256::digest(jwt.as_bytes()).into());
    }
    anyhow::bail!("SECRETS_ENCRYPTION_KEY or JWT_SECRET is required for import jobs")
}

fn decode_key(raw: &str) -> anyhow::Result<[u8; 32]> {
    let trimmed = raw.trim();
    if let Ok(bytes) = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        trimmed,
    ) {
        if bytes.len() == 32 {
            let mut key = [0u8; 32];
            key.copy_from_slice(&bytes);
            return Ok(key);
        }
    }
    if trimmed.len() == 64 && trimmed.chars().all(|c| c.is_ascii_hexdigit()) {
        let mut key = [0u8; 32];
        for (i, chunk) in trimmed.as_bytes().chunks(2).enumerate() {
            let hex = std::str::from_utf8(chunk)?;
            key[i] = u8::from_str_radix(hex, 16)?;
        }
        return Ok(key);
    }
    anyhow::bail!("SECRETS_ENCRYPTION_KEY must be 32-byte base64 or 64-char hex")
}

fn decrypt_secret(key: &[u8; 32], blob: &[u8]) -> anyhow::Result<String> {
    if blob.len() <= NONCE_LEN {
        anyhow::bail!("invalid encrypted secret blob");
    }
    let cipher = Aes256Gcm::new(key.into());
    let (nonce_bytes, ciphertext) = blob.split_at(NONCE_LEN);
    let nonce = Nonce::from_slice(nonce_bytes);
    let plain = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| anyhow::anyhow!("decrypt secret: {e}"))?;
    Ok(String::from_utf8(plain)?)
}

#[derive(sqlx::FromRow)]
struct JobRow {
    id: Uuid,
    organization_id: Uuid,
    created_by: Uuid,
    credential_id: Uuid,
    #[allow(dead_code)]
    provider: String,
    import_issues: bool,
    import_pull_requests: bool,
    import_wiki: bool,
    on_conflict: ImportOnConflict,
}

#[derive(sqlx::FromRow)]
struct RepoRow {
    id: Uuid,
    source_full_name: String,
    source_clone_url: String,
    target_slug: String,
    target_name: String,
    description: Option<String>,
    visibility: String,
    default_branch: Option<String>,
    repository_id: Option<Uuid>,
    status: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use aes_gcm::{
        aead::{Aead, AeadCore, KeyInit, OsRng},
        Aes256Gcm,
    };
    use base64::Engine;

    #[test]
    fn import_job_final_status_marks_total_failure() {
        assert_eq!(import_job_final_status(0, 3), "done");
        assert_eq!(import_job_final_status(1, 3), "done");
        assert_eq!(import_job_final_status(3, 3), "failed");
    }

    #[test]
    fn parse_default_branch_normalizes_ref() {
        assert_eq!(
            parse_default_branch("refs/heads/main\n"),
            Some("main".to_string())
        );
        assert_eq!(parse_default_branch("develop"), Some("develop".to_string()));
        assert_eq!(parse_default_branch("  \n"), None);
    }

    #[test]
    fn authenticated_clone_url_injects_token() {
        let url = authenticated_clone_url(
            ImportProvider::Github,
            "https://github.com/acme/widget.git",
            "tok",
        )
        .unwrap();
        assert_eq!(
            url,
            "https://x-access-token:tok@github.com/acme/widget.git"
        );

        let gitlab = authenticated_clone_url(
            ImportProvider::Gitlab,
            "https://gitlab.com/acme/widget.git",
            "tok",
        )
        .unwrap();
        assert!(gitlab.contains("oauth2:tok@"));
    }

    #[test]
    fn authenticated_clone_url_rejects_existing_credentials() {
        let err = authenticated_clone_url(
            ImportProvider::Github,
            "https://user:pass@github.com/acme/widget.git",
            "tok",
        )
        .unwrap_err();
        assert!(err.to_string().contains("already contains credentials"));
    }

    #[test]
    fn decode_key_accepts_base64_and_hex() {
        let raw = [7u8; 32];
        let b64 = base64::engine::general_purpose::STANDARD.encode(raw);
        assert_eq!(decode_key(&b64).unwrap(), raw);

        let hex = "aa".repeat(32);
        let from_hex = decode_key(&hex).unwrap();
        assert_eq!(from_hex, [0xaa; 32]);
    }

    #[test]
    fn authenticated_clone_url_rejects_invalid_url() {
        let err = authenticated_clone_url(ImportProvider::Github, "not-a-url", "tok")
            .unwrap_err();
        assert!(err.to_string().contains("invalid clone URL"));
    }

    #[test]
    fn decode_key_rejects_invalid_values() {
        assert!(decode_key("too-short").is_err());
        assert!(decode_key(&"zz".repeat(32)).is_err());
    }

    #[test]
    fn load_secrets_key_derives_from_jwt_secret() {
        let prev_secrets = std::env::var("SECRETS_ENCRYPTION_KEY").ok();
        let prev_jwt = std::env::var("JWT_SECRET").ok();
        std::env::remove_var("SECRETS_ENCRYPTION_KEY");
        std::env::set_var("JWT_SECRET", "test-jwt-for-import");
        let key = load_secrets_key().unwrap();
        let expected: [u8; 32] = Sha256::digest(b"test-jwt-for-import").into();
        assert_eq!(key, expected);
        if let Some(value) = prev_secrets {
            std::env::set_var("SECRETS_ENCRYPTION_KEY", value);
        } else {
            std::env::remove_var("SECRETS_ENCRYPTION_KEY");
        }
        if let Some(value) = prev_jwt {
            std::env::set_var("JWT_SECRET", value);
        } else {
            std::env::remove_var("JWT_SECRET");
        }
    }

    #[test]
    fn decrypt_secret_rejects_short_blob() {
        let key = [1u8; 32];
        let err = decrypt_secret(&key, &[0u8; 8]).unwrap_err();
        assert!(err.to_string().contains("invalid encrypted secret blob"));
    }

    #[test]
    fn decrypt_secret_round_trip() {
        let key = [9u8; 32];
        let cipher = Aes256Gcm::new((&key).into());
        let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
        let ciphertext = cipher.encrypt(&nonce, b"import-token".as_ref()).unwrap();
        let mut blob = nonce.to_vec();
        blob.extend_from_slice(&ciphertext);

        let plain = decrypt_secret(&key, &blob).unwrap();
        assert_eq!(plain, "import-token");
    }
}
