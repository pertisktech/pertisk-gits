use std::path::{Path, PathBuf};
use std::sync::Arc;

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use pertisk_domain::models::{
    ImportProvider, OrgRole, RepoVisibility,
};
use pertisk_git::config::repo_disk_path;
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use tokio::process::Command;
use uuid::Uuid;

const NONCE_LEN: usize = 12;

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
            SET status = 'mirroring', started_at = NOW(), updated_at = NOW()
            FROM (
                SELECT id
                FROM import_jobs
                WHERE status = 'pending'
                ORDER BY created_at ASC
                LIMIT 5
                FOR UPDATE SKIP LOCKED
            ) picked
            WHERE j.id = picked.id
            RETURNING j.id, j.organization_id, j.created_by, j.credential_id, j.provider::text, j.import_issues
            "#,
        )
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
        let org_slug = self.org_slug(job.organization_id).await?;

        let repos = sqlx::query_as::<_, RepoRow>(
            r#"
            SELECT
                id, source_full_name, source_clone_url, target_slug, target_name,
                description, visibility::text, default_branch
            FROM import_job_repos
            WHERE job_id = $1 AND status = 'pending'
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
                    &org_slug,
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

        let final_status = if failures > 0 && failures == repo_count {
            "failed"
        } else if failures > 0 {
            "done"
        } else {
            "done"
        };

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
        org_slug: &str,
        provider: ImportProvider,
        token: &str,
        base_url: &str,
        repo: &RepoRow,
    ) -> anyhow::Result<()> {
        let visibility = match repo.visibility.as_str() {
            "public" => RepoVisibility::Public,
            _ => RepoVisibility::Private,
        };

        let repository_id = self
            .ensure_repository(
                job.organization_id,
                job.created_by,
                &repo.target_slug,
                &repo.target_name,
                repo.description.as_deref(),
                visibility,
            )
            .await?;

        sqlx::query(
            r#"
            UPDATE import_job_repos
            SET repository_id = $2, status = 'mirroring', updated_at = NOW()
            WHERE id = $1
            "#,
        )
        .bind(repo.id)
        .bind(repository_id)
        .execute(&self.pool)
        .await?;

        let repo_path = repo_disk_path(&self.repos_root, org_slug, &repo.target_slug);
        let auth_url = authenticated_clone_url(provider, &repo.source_clone_url, token)?;
        mirror_repository(&auth_url, &repo_path).await?;

        let default_branch = read_default_branch(&repo_path)
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

        if job.import_issues {
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

            match crate::metadata::import_repo_metadata(
                &self.pool,
                provider,
                token,
                base_url,
                &repo.source_full_name,
                repository_id,
                job.created_by,
            )
            .await
            {
                Ok(stats) => tracing::info!(
                    repo = %repo.source_full_name,
                    labels = stats.labels,
                    milestones = stats.milestones,
                    issues = stats.issues,
                    "imported repository metadata"
                ),
                Err(err) => tracing::warn!(
                    repo = %repo.source_full_name,
                    "metadata import failed: {err:#}"
                ),
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

    async fn org_slug(&self, org_id: Uuid) -> anyhow::Result<String> {
        Ok(sqlx::query_scalar::<_, String>(
            "SELECT slug FROM organizations WHERE id = $1",
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
            other => anyhow::bail!("unknown provider {other}"),
        };
        let token = decrypt_secret(&self.secrets_key, &row.1)?;
        let base_url = row
            .2
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| match provider {
                ImportProvider::Github => "https://github.com".into(),
                ImportProvider::Gitlab => "https://gitlab.com".into(),
            });
        Ok((provider, token, base_url))
    }
}

async fn mirror_repository(auth_url: &str, repo_path: &Path) -> anyhow::Result<()> {
    if let Some(parent) = repo_path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }

    if repo_path.join("HEAD").exists() {
        let status = Command::new("git")
            .args([
                "-C",
                repo_path.to_str().unwrap_or_default(),
                "remote",
                "set-url",
                "origin",
                auth_url,
            ])
            .status()
            .await?;
        if !status.success() {
            anyhow::bail!("git remote set-url failed");
        }

        let status = Command::new("git")
            .args([
                "-C",
                repo_path.to_str().unwrap_or_default(),
                "remote",
                "update",
                "--prune",
            ])
            .status()
            .await?;
        if !status.success() {
            anyhow::bail!("git remote update failed");
        }
        return Ok(());
    }

    if repo_path.exists() {
        tokio::fs::remove_dir_all(repo_path).await?;
    }

    let status = Command::new("git")
        .args([
            "clone",
            "--mirror",
            auth_url,
            repo_path.to_str().unwrap_or_default(),
        ])
        .status()
        .await?;

    if !status.success() {
        anyhow::bail!("git clone --mirror failed");
    }

    Ok(())
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

    let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
    value
        .strip_prefix("refs/heads/")
        .map(str::to_string)
        .or(Some(value))
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
        ImportProvider::Github => "x-access-token",
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
}
