use std::path::Path;

use tantivy::Term;
use uuid::Uuid;

use crate::git_files::{list_indexable_paths, read_blob_at_commit};
use crate::schema::{open_index, CodeSearchSchema};

pub struct IndexRepositoryInput<'a> {
    pub index_root: &'a Path,
    pub repo_path: &'a Path,
    pub repository_id: Uuid,
    pub org_slug: &'a str,
    pub repo_slug: &'a str,
    pub commit_sha: &'a str,
    pub ref_name: &'a str,
}

pub struct IndexRepositoryResult {
    pub document_count: u32,
    pub skipped_files: u32,
}

pub async fn index_repository(input: IndexRepositoryInput<'_>) -> anyhow::Result<IndexRepositoryResult> {
    let paths = list_indexable_paths(input.repo_path, input.commit_sha).await?;

    let schema = CodeSearchSchema::build();
    let index = open_index(input.index_root)?;
    let mut writer = index.writer(50_000_000)?;

    writer.delete_term(Term::from_field_text(
        schema.repository_id,
        &input.repository_id.to_string(),
    ));

    let mut document_count = 0u32;
    let mut skipped_files = 0u32;

    for path in paths {
        let Some(content) = read_blob_at_commit(input.repo_path, input.commit_sha, &path).await? else {
            skipped_files += 1;
            continue;
        };

        if content.trim().is_empty() {
            skipped_files += 1;
            continue;
        }

        let mut doc = tantivy::TantivyDocument::default();
        doc.add_text(schema.repository_id, input.repository_id.to_string());
        doc.add_text(schema.org_slug, input.org_slug);
        doc.add_text(schema.repo_slug, input.repo_slug);
        doc.add_text(schema.path, &path);
        doc.add_text(schema.content, &content);
        doc.add_text(schema.commit_sha, input.commit_sha);
        doc.add_text(schema.ref_name, input.ref_name);
        writer.add_document(doc)?;
        document_count += 1;
    }

    writer.commit()?;

    Ok(IndexRepositoryResult {
        document_count,
        skipped_files,
    })
}
