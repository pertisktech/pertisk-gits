use std::path::Path;

use chrono::{DateTime, Utc};
use pertisk_domain::models::Repository;
use pertisk_git::explorer::{self, RefKind};
use sqlx::PgPool;
use uuid::Uuid;

pub async fn last_commit_at_from_git(
    repo_path: &Path,
    default_branch: &str,
) -> Option<DateTime<Utc>> {
    let ts = explorer::latest_commit_time(repo_path, default_branch, RefKind::Branch)
        .await
        .ok()
        .flatten()?;
    DateTime::from_timestamp(ts, 0)
}

pub async fn refresh_repository_last_commit_at(
    pool: &PgPool,
    repository_id: Uuid,
    repo_path: &Path,
) -> Result<(), sqlx::Error> {
    let default_branch: String =
        sqlx::query_scalar("SELECT default_branch FROM repositories WHERE id = $1")
            .bind(repository_id)
            .fetch_one(pool)
            .await?;

    let Some(at) = last_commit_at_from_git(repo_path, &default_branch).await else {
        return Ok(());
    };

    sqlx::query("UPDATE repositories SET last_commit_at = $2 WHERE id = $1")
        .bind(repository_id)
        .bind(at)
        .execute(pool)
        .await?;

    Ok(())
}

pub async fn backfill_repository_last_commit_at(
    pool: &PgPool,
    repos_root: &Path,
    org_path: &str,
    repo: &mut Repository,
) {
    if repo.last_commit_at.is_some() {
        return;
    }

    let repo_path =
        pertisk_git::config::repo_disk_path(repos_root, org_path, &repo.slug);
    let Some(at) = last_commit_at_from_git(&repo_path, &repo.default_branch).await else {
        return;
    };

    repo.last_commit_at = Some(at);
    let _ = sqlx::query("UPDATE repositories SET last_commit_at = $2 WHERE id = $1")
        .bind(repo.id)
        .bind(at)
        .execute(pool)
        .await;
}
