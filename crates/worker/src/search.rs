use std::path::{Path, PathBuf};
use std::sync::Arc;

use pertisk_git::config::repo_disk_path;
use pertisk_search::{index_repository, IndexRepositoryInput};
use sqlx::PgPool;
use uuid::Uuid;

pub struct CodeIndexWorker {
    pub pool: PgPool,
    pub repos_root: Arc<PathBuf>,
    pub index_root: Arc<PathBuf>,
}

impl CodeIndexWorker {
    pub fn new(pool: PgPool, repos_root: Arc<PathBuf>, index_root: Arc<PathBuf>) -> Self {
        Self {
            pool,
            repos_root,
            index_root,
        }
    }

    pub async fn process_pending_jobs(&self) -> anyhow::Result<u32> {
        let jobs = sqlx::query_as::<_, IndexJobRow>(
            r#"
            SELECT j.id, j.repository_id, j.commit_sha, j.ref_name, o.slug AS org_slug, r.slug AS repo_slug
            FROM code_index_jobs j
            INNER JOIN repositories r ON r.id = j.repository_id
            INNER JOIN organizations o ON o.id = r.organization_id
            WHERE j.processed = FALSE
            ORDER BY j.created_at ASC
            LIMIT 10
            "#,
        )
        .fetch_all(&self.pool)
        .await?;

        let mut processed = 0u32;
        for job in jobs {
            if let Err(err) = self.process_job(&job).await {
                tracing::warn!(job_id = %job.id, %err, "code index job failed");
                sqlx::query(
                    r#"
                    UPDATE code_index_jobs
                    SET processed = TRUE,
                        processed_at = NOW(),
                        error_message = $2
                    WHERE id = $1
                    "#,
                )
                .bind(job.id)
                .bind(err.to_string())
                .execute(&self.pool)
                .await?;
            } else {
                sqlx::query(
                    r#"
                    UPDATE code_index_jobs
                    SET processed = TRUE, processed_at = NOW(), error_message = NULL
                    WHERE id = $1
                    "#,
                )
                .bind(job.id)
                .execute(&self.pool)
                .await?;
            }
            processed += 1;
        }

        Ok(processed)
    }

    async fn process_job(&self, job: &IndexJobRow) -> anyhow::Result<()> {
        let repo_path = repo_disk_path(&self.repos_root, &job.org_slug, &job.repo_slug);
        if !repo_path.exists() {
            anyhow::bail!("repository path not found");
        }

        let result = index_repository(IndexRepositoryInput {
            index_root: &self.index_root,
            repo_path: &repo_path,
            repository_id: job.repository_id,
            org_slug: &job.org_slug,
            repo_slug: &job.repo_slug,
            commit_sha: &job.commit_sha,
            ref_name: &job.ref_name,
        })
        .await?;

        sqlx::query(
            r#"
            INSERT INTO code_search_index_meta (repository_id, commit_sha, ref_name, document_count, indexed_at)
            VALUES ($1, $2, $3, $4, NOW())
            ON CONFLICT (repository_id) DO UPDATE SET
                commit_sha = EXCLUDED.commit_sha,
                ref_name = EXCLUDED.ref_name,
                document_count = EXCLUDED.document_count,
                indexed_at = NOW()
            "#,
        )
        .bind(job.repository_id)
        .bind(&job.commit_sha)
        .bind(&job.ref_name)
        .bind(result.document_count as i32)
        .execute(&self.pool)
        .await?;

        tracing::info!(
            repository_id = %job.repository_id,
            documents = result.document_count,
            skipped = result.skipped_files,
            "code search index updated"
        );

        Ok(())
    }
}

pub async fn enqueue_index_jobs(
    pool: &PgPool,
    repository_id: Uuid,
    updates: &[pertisk_git::RefUpdate],
) -> anyhow::Result<()> {
    for update in updates {
        if update.new_sha.chars().all(|c| c == '0') {
            continue;
        }
        if !update.ref_name.starts_with("refs/heads/") {
            continue;
        }

        sqlx::query(
            r#"
            INSERT INTO code_index_jobs (repository_id, commit_sha, ref_name)
            VALUES ($1, $2, $3)
            "#,
        )
        .bind(repository_id)
        .bind(&update.new_sha)
        .bind(&update.ref_name)
        .execute(pool)
        .await?;
    }
    Ok(())
}

pub fn default_index_root() -> PathBuf {
    std::env::var("SEARCH_INDEX_ROOT")
        .unwrap_or_else(|_| "data/search".into())
        .into()
}

pub fn ensure_index_root(path: &Path) -> anyhow::Result<()> {
    std::fs::create_dir_all(path)?;
    Ok(())
}

#[derive(sqlx::FromRow)]
struct IndexJobRow {
    id: Uuid,
    repository_id: Uuid,
    commit_sha: String,
    ref_name: String,
    org_slug: String,
    repo_slug: String,
}
