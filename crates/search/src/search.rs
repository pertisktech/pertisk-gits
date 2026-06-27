use std::collections::HashSet;
use std::path::Path;

use tantivy::collector::TopDocs;
use tantivy::query::{BooleanQuery, Occur, QueryParser, TermQuery};
use tantivy::schema::IndexRecordOption;
use tantivy::Term;
use uuid::Uuid;

use crate::schema::{open_index, stored_text, CodeSearchSchema};

#[derive(Debug, Clone, serde::Serialize)]
pub struct CodeSearchHit {
    pub repository_id: Uuid,
    pub org_slug: String,
    pub repo_slug: String,
    pub path: String,
    pub commit_sha: String,
    pub ref_name: String,
    pub snippet: String,
    pub score: f32,
}

pub struct CodeSearchOptions<'a> {
    pub index_root: &'a Path,
    pub query: &'a str,
    pub repository_id: Option<Uuid>,
    pub allowed_repository_ids: Option<&'a HashSet<Uuid>>,
    pub limit: usize,
}

pub fn search_code(options: CodeSearchOptions<'_>) -> anyhow::Result<Vec<CodeSearchHit>> {
    let query_text = options.query.trim();
    if query_text.len() < 2 {
        return Ok(Vec::new());
    }

    let schema = CodeSearchSchema::build();
    let index = open_index(options.index_root)?;
    let reader = index
        .reader_builder()
        .reload_policy(tantivy::ReloadPolicy::OnCommitWithDelay)
        .try_into()?;
    let searcher = reader.searcher();

    let mut query_parser = QueryParser::for_index(&index, vec![schema.content, schema.path]);
    query_parser.set_conjunction_by_default();
    let parsed = query_parser.parse_query(query_text)?;

    let query: Box<dyn tantivy::query::Query> = if let Some(repository_id) = options.repository_id {
        let term = Term::from_field_text(schema.repository_id, &repository_id.to_string());
        let repo_query: Box<dyn tantivy::query::Query> =
            Box::new(TermQuery::new(term, IndexRecordOption::Basic));
        Box::new(BooleanQuery::new(vec![
            (Occur::Must, parsed),
            (Occur::Must, repo_query),
        ]))
    } else {
        Box::new(parsed)
    };

    let top_docs = searcher.search(
        &query,
        &TopDocs::with_limit(options.limit.saturating_mul(4).max(options.limit)),
    )?;

    let mut hits = Vec::new();
    for (score, doc_address) in top_docs {
        let doc: tantivy::TantivyDocument = searcher.doc(doc_address)?;
        let Some(repository_id) = stored_text(&doc, schema.repository_id)
            .and_then(|value| Uuid::parse_str(&value).ok())
        else {
            continue;
        };

        if let Some(allowed) = options.allowed_repository_ids {
            if !allowed.contains(&repository_id) {
                continue;
            }
        }

        let org_slug = stored_text(&doc, schema.org_slug).unwrap_or_default();
        let repo_slug = stored_text(&doc, schema.repo_slug).unwrap_or_default();
        let path = stored_text(&doc, schema.path).unwrap_or_default();
        let commit_sha = stored_text(&doc, schema.commit_sha).unwrap_or_default();
        let ref_name = stored_text(&doc, schema.ref_name).unwrap_or_default();
        let content = stored_text(&doc, schema.content).unwrap_or_default();

        hits.push(CodeSearchHit {
            repository_id,
            org_slug,
            repo_slug,
            path: path.clone(),
            commit_sha,
            ref_name,
            snippet: make_snippet(&content, query_text),
            score,
        });

        if hits.len() >= options.limit {
            break;
        }
    }

    Ok(hits)
}

fn make_snippet(content: &str, query: &str) -> String {
    let needle = query.to_ascii_lowercase();
    let lower_content = content.to_ascii_lowercase();

    if let Some(index) = lower_content.find(&needle) {
        let start = index.saturating_sub(60);
        let end = (index + needle.len() + 120).min(content.len());
        let mut snippet = content[start..end].replace('\n', " ");
        if start > 0 {
            snippet = format!("…{snippet}");
        }
        if end < content.len() {
            snippet.push('…');
        }
        return snippet;
    }

    content
        .lines()
        .find(|line| !line.trim().is_empty())
        .unwrap_or("")
        .chars()
        .take(180)
        .collect()
}
