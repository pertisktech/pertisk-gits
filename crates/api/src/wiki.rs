use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{delete, get, patch, post},
    Json, Router,
};
use pertisk_domain::{models::*, DomainError};
use serde::Serialize;
use sqlx::PgPool;
use uuid::Uuid;
use validator::Validate;

use crate::{
    ensure_can_write_repo, load_repo_for_read, ApiError, AppState, AuthUser, OptionalAuth,
};

pub fn wiki_read_routes() -> Router<AppState> {
    Router::new()
        .route(
            "/organizations/{org_path}/repositories/{repo_slug}/wiki/pages",
            get(list_wiki_pages),
        )
        .route(
            "/organizations/{org_path}/repositories/{repo_slug}/wiki/pages/{page_slug}",
            get(get_wiki_page),
        )
        .route(
            "/organizations/{org_path}/repositories/{repo_slug}/wiki/pages/{page_slug}/revisions",
            get(list_wiki_revisions),
        )
        .route(
            "/organizations/{org_path}/repositories/{repo_slug}/wiki/pages/{page_slug}/revisions/{revision_id}",
            get(get_wiki_revision),
        )
}

pub fn wiki_write_routes() -> Router<AppState> {
    Router::new()
        .route(
            "/organizations/{org_path}/repositories/{repo_slug}/wiki/pages",
            post(create_wiki_page),
        )
        .route(
            "/organizations/{org_path}/repositories/{repo_slug}/wiki/pages/{page_slug}",
            patch(update_wiki_page).delete(delete_wiki_page),
        )
}

#[derive(Serialize)]
struct WikiPageSummary {
    slug: String,
    title: String,
    parent_slug: Option<String>,
    position: i32,
    updated_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Serialize)]
struct WikiPageListResponse {
    pages: Vec<WikiPageSummary>,
}

#[derive(Serialize)]
struct WikiPageDetailResponse {
    page: WikiPage,
    author: UserPublic,
}

#[derive(Serialize)]
struct WikiRevisionSummary {
    id: Uuid,
    author: UserPublic,
    title: String,
    created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Serialize)]
struct WikiRevisionListResponse {
    revisions: Vec<WikiRevisionSummary>,
}

#[derive(Serialize)]
struct WikiRevisionDetailResponse {
    revision: WikiPageRevision,
    author: UserPublic,
}

async fn load_repo(
    state: &AppState,
    org_slug: &str,
    repo_slug: &str,
    auth: Option<&AuthUser>,
) -> Result<(Repository, Uuid), ApiError> {
    let (_org, repo, _path) =
        load_repo_for_read(state, org_slug, repo_slug, auth).await?;
    Ok((repo, auth.map(|a| a.user_id).unwrap_or(Uuid::nil())))
}

async fn fetch_user_public(pool: &PgPool, user_id: Uuid) -> Result<UserPublic, ApiError> {
    sqlx::query_as::<_, UserPublic>(
        r#"
        SELECT id, username, email, display_name, created_at
        FROM users
        WHERE id = $1
        "#,
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?
    .ok_or_else(|| DomainError::NotFound.into())
}

pub fn slugify_wiki_title(title: &str) -> String {
    let mut slug = String::new();
    let mut last_dash = false;

    for ch in title.trim().to_lowercase().chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch);
            last_dash = false;
        } else if !last_dash && !slug.is_empty() {
            slug.push('-');
            last_dash = true;
        }
    }

    slug.trim_matches('-').to_string()
}

async fn unique_slug(pool: &PgPool, repository_id: Uuid, base: &str) -> Result<String, ApiError> {
    let base = if base.is_empty() { "page".into() } else { base.to_string() };
    let mut candidate = base.clone();
    let mut suffix = 2;

    loop {
        let exists = sqlx::query_scalar::<_, bool>(
            r#"
            SELECT EXISTS(
                SELECT 1 FROM wiki_pages WHERE repository_id = $1 AND slug = $2
            )
            "#,
        )
        .bind(repository_id)
        .bind(&candidate)
        .fetch_one(pool)
        .await
        .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

        if !exists {
            return Ok(candidate);
        }

        candidate = format!("{base}-{suffix}");
        suffix += 1;
    }
}

async fn get_page_by_slug(
    pool: &PgPool,
    repository_id: Uuid,
    slug: &str,
) -> Result<WikiPage, ApiError> {
    sqlx::query_as::<_, WikiPage>(
        r#"
        SELECT id, repository_id, slug, title, body, author_id, parent_slug, position,
               created_at, updated_at
        FROM wiki_pages
        WHERE repository_id = $1 AND slug = $2
        "#,
    )
    .bind(repository_id)
    .bind(slug)
    .fetch_optional(pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?
    .ok_or_else(|| DomainError::NotFound.into())
}

async fn insert_revision(
    pool: &PgPool,
    page: &WikiPage,
    author_id: Uuid,
) -> Result<(), ApiError> {
    sqlx::query(
        r#"
        INSERT INTO wiki_page_revisions (page_id, author_id, title, body)
        VALUES ($1, $2, $3, $4)
        "#,
    )
    .bind(page.id)
    .bind(author_id)
    .bind(&page.title)
    .bind(&page.body)
    .execute(pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;
    Ok(())
}

async fn list_wiki_pages(
    State(state): State<AppState>,
    OptionalAuth(auth): OptionalAuth,
    Path((org_path, repo_slug)): Path<(String, String)>,
) -> Result<Json<WikiPageListResponse>, ApiError> {
    let (repo, _) = load_repo(&state, &crate::org::org_path_from_param(&org_path), &repo_slug, auth.as_ref()).await?;

    let pages = sqlx::query_as::<_, WikiPage>(
        r#"
        SELECT id, repository_id, slug, title, body, author_id, parent_slug, position,
               created_at, updated_at
        FROM wiki_pages
        WHERE repository_id = $1
        ORDER BY position ASC, title ASC
        "#,
    )
    .bind(repo.id)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    Ok(Json(WikiPageListResponse {
        pages: pages
            .into_iter()
            .map(|page| WikiPageSummary {
                slug: page.slug,
                title: page.title,
                parent_slug: page.parent_slug,
                position: page.position,
                updated_at: page.updated_at,
            })
            .collect(),
    }))
}

async fn get_wiki_page(
    State(state): State<AppState>,
    OptionalAuth(auth): OptionalAuth,
    Path((org_path, repo_slug, page_slug)): Path<(String, String, String)>,
) -> Result<Json<WikiPageDetailResponse>, ApiError> {
    let (repo, _) = load_repo(&state, &crate::org::org_path_from_param(&org_path), &repo_slug, auth.as_ref()).await?;
    let page = get_page_by_slug(&state.pool, repo.id, &page_slug).await?;
    let author = fetch_user_public(&state.pool, page.author_id).await?;

    Ok(Json(WikiPageDetailResponse { page, author }))
}

async fn create_wiki_page(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_path, repo_slug)): Path<(String, String)>,
    Json(body): Json<CreateWikiPageRequest>,
) -> Result<(StatusCode, Json<WikiPageDetailResponse>), ApiError> {
    body.validate()
        .map_err(|e| ApiError::from(DomainError::Validation(e.to_string())))?;

    let (_org, repo, _path) =
        load_repo_for_read(&state, &crate::org::org_path_from_param(&org_path), &repo_slug, Some(&auth)).await?;
    ensure_can_write_repo(&state, &crate::org::org_path_from_param(&org_path), &repo, &auth).await?;

    let base_slug = body
        .slug
        .as_deref()
        .map(slugify_wiki_title)
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| slugify_wiki_title(&body.title));
    let slug = unique_slug(&state.pool, repo.id, &base_slug).await?;
    let content = body.body.unwrap_or_default();
    let position = body.position.unwrap_or(0);

    let page = sqlx::query_as::<_, WikiPage>(
        r#"
        INSERT INTO wiki_pages (
            repository_id, slug, title, body, author_id, parent_slug, position
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id, repository_id, slug, title, body, author_id, parent_slug, position,
                  created_at, updated_at
        "#,
    )
    .bind(repo.id)
    .bind(&slug)
    .bind(&body.title)
    .bind(&content)
    .bind(auth.user_id)
    .bind(&body.parent_slug)
    .bind(position)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    insert_revision(&state.pool, &page, auth.user_id).await?;
    let author = fetch_user_public(&state.pool, auth.user_id).await?;

    Ok((StatusCode::CREATED, Json(WikiPageDetailResponse { page, author })))
}

async fn update_wiki_page(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_path, repo_slug, page_slug)): Path<(String, String, String)>,
    Json(body): Json<UpdateWikiPageRequest>,
) -> Result<Json<WikiPageDetailResponse>, ApiError> {
    body.validate()
        .map_err(|e| ApiError::from(DomainError::Validation(e.to_string())))?;

    let (_org, repo, _path) =
        load_repo_for_read(&state, &crate::org::org_path_from_param(&org_path), &repo_slug, Some(&auth)).await?;
    ensure_can_write_repo(&state, &crate::org::org_path_from_param(&org_path), &repo, &auth).await?;

    let existing = get_page_by_slug(&state.pool, repo.id, &page_slug).await?;

    let title = body.title.unwrap_or(existing.title);
    let content = body.body.unwrap_or(existing.body);
    let parent_slug = body.parent_slug.or(existing.parent_slug);
    let position = body.position.unwrap_or(existing.position);

    let page = sqlx::query_as::<_, WikiPage>(
        r#"
        UPDATE wiki_pages
        SET title = $3,
            body = $4,
            parent_slug = $5,
            position = $6,
            updated_at = NOW()
        WHERE repository_id = $1 AND slug = $2
        RETURNING id, repository_id, slug, title, body, author_id, parent_slug, position,
                  created_at, updated_at
        "#,
    )
    .bind(repo.id)
    .bind(&page_slug)
    .bind(&title)
    .bind(&content)
    .bind(&parent_slug)
    .bind(position)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    insert_revision(&state.pool, &page, auth.user_id).await?;
    let author = fetch_user_public(&state.pool, page.author_id).await?;

    Ok(Json(WikiPageDetailResponse { page, author }))
}

async fn delete_wiki_page(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((org_path, repo_slug, page_slug)): Path<(String, String, String)>,
) -> Result<StatusCode, ApiError> {
    let (_org, repo, _path) =
        load_repo_for_read(&state, &crate::org::org_path_from_param(&org_path), &repo_slug, Some(&auth)).await?;
    ensure_can_write_repo(&state, &crate::org::org_path_from_param(&org_path), &repo, &auth).await?;

    let result = sqlx::query(
        r#"
        DELETE FROM wiki_pages
        WHERE repository_id = $1 AND slug = $2
        "#,
    )
    .bind(repo.id)
    .bind(&page_slug)
    .execute(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    if result.rows_affected() == 0 {
        return Err(DomainError::NotFound.into());
    }

    Ok(StatusCode::NO_CONTENT)
}

async fn list_wiki_revisions(
    State(state): State<AppState>,
    OptionalAuth(auth): OptionalAuth,
    Path((org_path, repo_slug, page_slug)): Path<(String, String, String)>,
) -> Result<Json<WikiRevisionListResponse>, ApiError> {
    let (repo, _) = load_repo(&state, &crate::org::org_path_from_param(&org_path), &repo_slug, auth.as_ref()).await?;
    let page = get_page_by_slug(&state.pool, repo.id, &page_slug).await?;

    let rows = sqlx::query_as::<_, WikiPageRevision>(
        r#"
        SELECT id, page_id, author_id, title, body, created_at
        FROM wiki_page_revisions
        WHERE page_id = $1
        ORDER BY created_at DESC
        LIMIT 50
        "#,
    )
    .bind(page.id)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    let mut revisions = Vec::new();
    for row in rows {
        let author = fetch_user_public(&state.pool, row.author_id).await?;
        revisions.push(WikiRevisionSummary {
            id: row.id,
            author,
            title: row.title,
            created_at: row.created_at,
        });
    }

    Ok(Json(WikiRevisionListResponse { revisions }))
}

async fn get_wiki_revision(
    State(state): State<AppState>,
    OptionalAuth(auth): OptionalAuth,
    Path((org_path, repo_slug, page_slug, revision_id)): Path<(String, String, String, Uuid)>,
) -> Result<Json<WikiRevisionDetailResponse>, ApiError> {
    let (repo, _) = load_repo(&state, &crate::org::org_path_from_param(&org_path), &repo_slug, auth.as_ref()).await?;
    let page = get_page_by_slug(&state.pool, repo.id, &page_slug).await?;

    let revision = sqlx::query_as::<_, WikiPageRevision>(
        r#"
        SELECT id, page_id, author_id, title, body, created_at
        FROM wiki_page_revisions
        WHERE id = $1 AND page_id = $2
        "#,
    )
    .bind(revision_id)
    .bind(page.id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?
    .ok_or_else(|| ApiError::from(DomainError::NotFound))?;

    let author = fetch_user_public(&state.pool, revision.author_id).await?;

    Ok(Json(WikiRevisionDetailResponse { revision, author }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugify_wiki_title_normalizes() {
        assert_eq!(slugify_wiki_title("Getting Started"), "getting-started");
        assert_eq!(slugify_wiki_title("  API / Reference  "), "api-reference");
    }
}
