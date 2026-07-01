use std::process::Command;
use tempfile::TempDir;
use uuid::Uuid;

use pertisk_search::{index_repository, IndexRepositoryInput};

fn init_repo(dir: &std::path::Path) -> String {
    Command::new("git").current_dir(dir).args(["init", "-q"]).status().unwrap();
    Command::new("git").current_dir(dir).args(["config", "user.email", "t@e.com"]).status().unwrap();
    Command::new("git").current_dir(dir).args(["config", "user.name", "T"]).status().unwrap();
    std::fs::write(dir.join("main.rs"), "fn pertisk_search_fixture() {}").unwrap();
    Command::new("git").current_dir(dir).args(["add", "main.rs"]).status().unwrap();
    Command::new("git").current_dir(dir).args(["commit", "-q", "-m", "init"]).status().unwrap();
    String::from_utf8(Command::new("git").current_dir(dir).args(["rev-parse", "HEAD"]).output().unwrap().stdout)
        .unwrap()
        .trim()
        .to_string()
}

#[tokio::test]
async fn indexes_fixture_repository() {
    let repo = TempDir::new().unwrap();
    let index = TempDir::new().unwrap();
    let sha = init_repo(repo.path());
    let result = index_repository(IndexRepositoryInput {
        index_root: index.path(),
        repo_path: repo.path(),
        repository_id: Uuid::new_v4(),
        org_slug: "acme",
        repo_slug: "widget",
        commit_sha: &sha,
        ref_name: "main",
    })
    .await
    .unwrap();
    assert_eq!(result.document_count, 1);
}
