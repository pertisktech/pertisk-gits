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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::indexer::{index_repository, IndexRepositoryInput};
    use std::collections::HashSet;
    use std::process::Command;
    use tempfile::TempDir;
    use uuid::Uuid;

    fn init_repo(dir: &std::path::Path) -> String {
        Command::new("git").current_dir(dir).args(["init", "-q"]).status().unwrap();
        Command::new("git").current_dir(dir).args(["config", "user.email", "t@e.com"]).status().unwrap();
        Command::new("git").current_dir(dir).args(["config", "user.name", "T"]).status().unwrap();
        std::fs::write(dir.join("search_me.rs"), "fn find_unique_token_xyz() {}").unwrap();
        Command::new("git").current_dir(dir).args(["add", "."]).status().unwrap();
        Command::new("git").current_dir(dir).args(["commit", "-q", "-m", "init"]).status().unwrap();
        String::from_utf8(Command::new("git").current_dir(dir).args(["rev-parse", "HEAD"]).output().unwrap().stdout)
            .unwrap()
            .trim()
            .to_string()
    }

    #[tokio::test]
    async fn search_code_finds_indexed_token() {
        let repo = TempDir::new().unwrap();
        let index = TempDir::new().unwrap();
        let sha = init_repo(repo.path());
        let repository_id = Uuid::new_v4();
        index_repository(IndexRepositoryInput {
            index_root: index.path(),
            repo_path: repo.path(),
            repository_id,
            org_slug: "acme",
            repo_slug: "app",
            commit_sha: &sha,
            ref_name: "main",
        })
        .await
        .unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;
        let hits = search_code(CodeSearchOptions {
            index_root: index.path(),
            query: "unique_token_xyz",
            repository_id: Some(repository_id),
            allowed_repository_ids: None,
            limit: 5,
        })
        .unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].path, "search_me.rs");
    }

    #[test]
    fn short_query_returns_empty() {
        let index = TempDir::new().unwrap();
        let hits = search_code(CodeSearchOptions {
            index_root: index.path(),
            query: "a",
            repository_id: None,
            allowed_repository_ids: None,
            limit: 5,
        })
        .unwrap();
        assert!(hits.is_empty());
    }

    #[test]
    fn make_snippet_finds_match_and_truncates() {
        let content = "prefix line\nneedle appears here in the content\nsuffix";
        let snippet = make_snippet(content, "needle");
        assert!(snippet.contains("needle"));
        assert!(snippet.starts_with('…') || snippet.contains("needle"));

        let long = "x".repeat(300);
        let fallback = make_snippet(&long, "missing");
        assert!(!fallback.is_empty());
        assert!(fallback.len() <= 181);

        let long_match = format!("{}needle{}", "a".repeat(200), "z".repeat(200));
        let end_snippet = make_snippet(&long_match, "needle");
        assert!(end_snippet.ends_with('…'));
    }

    #[tokio::test]
    async fn search_respects_result_limit() {
        let repo = TempDir::new().unwrap();
        let index = TempDir::new().unwrap();
        let _sha = init_repo(repo.path());
        let repository_id = Uuid::new_v4();
        for i in 0..3 {
            std::fs::write(
                repo.path().join(format!("file{i}.rs")),
                format!("fn token_{i}() {{}}"),
            )
            .unwrap();
            Command::new("git")
                .current_dir(repo.path())
                .args(["add", "."])
                .status()
                .unwrap();
            Command::new("git")
                .current_dir(repo.path())
                .args(["commit", "-q", "-m", &format!("add {i}")])
                .status()
                .unwrap();
        }
        let sha = String::from_utf8(
            Command::new("git")
                .current_dir(repo.path())
                .args(["rev-parse", "HEAD"])
                .output()
                .unwrap()
                .stdout,
        )
        .unwrap()
        .trim()
        .to_string();
        index_repository(IndexRepositoryInput {
            index_root: index.path(),
            repo_path: repo.path(),
            repository_id,
            org_slug: "acme",
            repo_slug: "app",
            commit_sha: &sha,
            ref_name: "main",
        })
        .await
        .unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;
        let hits = search_code(CodeSearchOptions {
            index_root: index.path(),
            query: "token",
            repository_id: Some(repository_id),
            allowed_repository_ids: None,
            limit: 2,
        })
        .unwrap();
        assert_eq!(hits.len(), 2);
    }

    #[tokio::test]
    async fn indexer_skips_empty_files() {
        let repo = TempDir::new().unwrap();
        let index = TempDir::new().unwrap();
        Command::new("git")
            .current_dir(repo.path())
            .args(["init", "-q"])
            .status()
            .unwrap();
        Command::new("git")
            .current_dir(repo.path())
            .args(["config", "user.email", "t@e.com"])
            .status()
            .unwrap();
        Command::new("git")
            .current_dir(repo.path())
            .args(["config", "user.name", "T"])
            .status()
            .unwrap();
        std::fs::write(repo.path().join("empty.rs"), "   \n").unwrap();
        std::fs::write(repo.path().join("real.rs"), "fn ok() {}").unwrap();
        Command::new("git")
            .current_dir(repo.path())
            .args(["add", "."])
            .status()
            .unwrap();
        Command::new("git")
            .current_dir(repo.path())
            .args(["commit", "-q", "-m", "init"])
            .status()
            .unwrap();
        let sha = String::from_utf8(
            Command::new("git")
                .current_dir(repo.path())
                .args(["rev-parse", "HEAD"])
                .output()
                .unwrap()
                .stdout,
        )
        .unwrap()
        .trim()
        .to_string();
        let result = index_repository(IndexRepositoryInput {
            index_root: index.path(),
            repo_path: repo.path(),
            repository_id: Uuid::new_v4(),
            org_slug: "acme",
            repo_slug: "app",
            commit_sha: &sha,
            ref_name: "main",
        })
        .await
        .unwrap();
        assert_eq!(result.document_count, 1);
        assert_eq!(result.skipped_files, 1);
    }

    #[tokio::test]
    async fn search_respects_allowed_repository_ids() {
        let repo = TempDir::new().unwrap();
        let index = TempDir::new().unwrap();
        let sha = init_repo(repo.path());
        let allowed_id = Uuid::new_v4();
        let blocked_id = Uuid::new_v4();
        index_repository(IndexRepositoryInput {
            index_root: index.path(),
            repo_path: repo.path(),
            repository_id: allowed_id,
            org_slug: "acme",
            repo_slug: "allowed",
            commit_sha: &sha,
            ref_name: "main",
        })
        .await
        .unwrap();
        index_repository(IndexRepositoryInput {
            index_root: index.path(),
            repo_path: repo.path(),
            repository_id: blocked_id,
            org_slug: "acme",
            repo_slug: "blocked",
            commit_sha: &sha,
            ref_name: "main",
        })
        .await
        .unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;
        let allowed = HashSet::from([allowed_id]);
        let hits = search_code(CodeSearchOptions {
            index_root: index.path(),
            query: "unique_token_xyz",
            repository_id: None,
            allowed_repository_ids: Some(&allowed),
            limit: 10,
        })
        .unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].repository_id, allowed_id);
    }
}
