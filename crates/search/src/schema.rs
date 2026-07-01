use std::path::Path;

use tantivy::schema::Schema;

pub const REPOSITORY_ID: &str = "repository_id";
pub const ORG_SLUG: &str = "org_slug";
pub const REPO_SLUG: &str = "repo_slug";
pub const PATH: &str = "path";
pub const CONTENT: &str = "content";
pub const COMMIT_SHA: &str = "commit_sha";
pub const REF_NAME: &str = "ref_name";

pub struct CodeSearchSchema {
    pub schema: Schema,
    pub repository_id: tantivy::schema::Field,
    pub org_slug: tantivy::schema::Field,
    pub repo_slug: tantivy::schema::Field,
    pub path: tantivy::schema::Field,
    pub content: tantivy::schema::Field,
    pub commit_sha: tantivy::schema::Field,
    pub ref_name: tantivy::schema::Field,
}

impl CodeSearchSchema {
    pub fn build() -> Self {
        let mut builder = tantivy::schema::SchemaBuilder::default();
        let repository_id = builder.add_text_field(REPOSITORY_ID, tantivy::schema::STRING | tantivy::schema::STORED);
        let org_slug = builder.add_text_field(ORG_SLUG, tantivy::schema::STRING | tantivy::schema::STORED);
        let repo_slug = builder.add_text_field(REPO_SLUG, tantivy::schema::STRING | tantivy::schema::STORED);
        let path = builder.add_text_field(PATH, tantivy::schema::TEXT | tantivy::schema::STORED);
        let content = builder.add_text_field(CONTENT, tantivy::schema::TEXT);
        let commit_sha = builder.add_text_field(COMMIT_SHA, tantivy::schema::STRING | tantivy::schema::STORED);
        let ref_name = builder.add_text_field(REF_NAME, tantivy::schema::STRING | tantivy::schema::STORED);
        let schema = builder.build();

        Self {
            schema,
            repository_id,
            org_slug,
            repo_slug,
            path,
            content,
            commit_sha,
            ref_name,
        }
    }
}

pub fn open_index(index_root: &Path) -> anyhow::Result<tantivy::Index> {
    std::fs::create_dir_all(index_root)?;
    let schema = CodeSearchSchema::build();
    Ok(tantivy::Index::open_or_create(
        tantivy::directory::MmapDirectory::open(index_root)?,
        schema.schema.clone(),
    )?)
}

pub fn stored_text(doc: &tantivy::TantivyDocument, field: tantivy::schema::Field) -> Option<String> {
    doc.get_first(field).and_then(|value| match value {
        tantivy::schema::OwnedValue::Str(text) => Some(text.clone()),
        _ => None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn build_schema_has_all_fields() {
        let schema = CodeSearchSchema::build();
        assert_eq!(schema.schema.num_fields(), 7);
    }

    #[test]
    fn open_index_creates_directory() {
        let tmp = TempDir::new().unwrap();
        let index = open_index(tmp.path()).unwrap();
        assert!(index.schema().num_fields() > 0);
        // idempotent open
        let _ = open_index(tmp.path()).unwrap();
    }

    #[test]
    fn stored_text_reads_string_fields() {
        let schema = CodeSearchSchema::build();
        let mut doc = tantivy::TantivyDocument::default();
        doc.add_text(schema.path, "src/main.rs");
        assert_eq!(
            stored_text(&doc, schema.path).as_deref(),
            Some("src/main.rs")
        );
        assert!(stored_text(&doc, schema.content).is_none());
    }
}
