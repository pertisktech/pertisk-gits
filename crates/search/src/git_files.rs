use std::path::Path;

use tokio::process::Command;

pub const MAX_FILE_BYTES: usize = 256 * 1024;
pub const MAX_FILES_PER_REPO: usize = 5_000;

const INDEXABLE_EXTENSIONS: &[&str] = &[
    "rs", "toml", "yaml", "yml", "json", "md", "txt", "sql", "sh", "bash", "zsh", "fish",
    "py", "go", "java", "kt", "kts", "scala", "rb", "php", "js", "jsx", "ts", "tsx", "mjs",
    "cjs", "css", "scss", "sass", "less", "html", "htm", "xml", "svg", "vue", "svelte",
    "c", "cc", "cpp", "cxx", "h", "hh", "hpp", "cs", "swift", "lua", "pl", "pm", "r",
    "dockerfile", "makefile", "cmake", "gradle", "properties", "ini", "cfg", "conf",
    "env", "example", "gitignore", "gitattributes", "editorconfig",
];

pub fn is_indexable_path(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    if lower.starts_with("node_modules/")
        || lower.contains("/node_modules/")
        || lower.starts_with("vendor/")
        || lower.contains("/vendor/")
        || lower.starts_with("dist/")
        || lower.contains("/dist/")
    {
        return false;
    }
    if lower.ends_with("lock") || lower.ends_with(".lock") {
        return false;
    }

    let file_name = lower.rsplit('/').next().unwrap_or(&lower);
    if file_name == "dockerfile" || file_name.starts_with("makefile") {
        return true;
    }

    let Some(ext) = lower.rsplit('.').next() else {
        return false;
    };
    INDEXABLE_EXTENSIONS.contains(&ext)
}

pub async fn list_indexable_paths(repo_path: &Path, commit_sha: &str) -> anyhow::Result<Vec<String>> {
    let output = Command::new("git")
        .current_dir(repo_path)
        .args(["ls-tree", "-r", "--name-only", commit_sha])
        .output()
        .await?;

    if !output.status.success() {
        anyhow::bail!(
            "git ls-tree failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    let mut paths: Vec<String> = String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter(|line| !line.trim().is_empty())
        .filter(|line| is_indexable_path(line))
        .take(MAX_FILES_PER_REPO)
        .map(str::to_string)
        .collect();

    paths.sort_unstable();
    Ok(paths)
}

pub async fn read_blob_at_commit(
    repo_path: &Path,
    commit_sha: &str,
    path: &str,
) -> anyhow::Result<Option<String>> {
    let output = Command::new("git")
        .current_dir(repo_path)
        .args(["show", &format!("{commit_sha}:{path}")])
        .output()
        .await?;

    if !output.status.success() {
        return Ok(None);
    }

    if output.stdout.len() > MAX_FILE_BYTES {
        return Ok(None);
    }

    if output.stdout.iter().any(|byte| *byte == 0) {
        return Ok(None);
    }

    Ok(Some(String::from_utf8_lossy(&output.stdout).into_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filters_paths() {
        assert!(is_indexable_path("src/main.rs"));
        assert!(!is_indexable_path("Cargo.lock"));
        assert!(!is_indexable_path("node_modules/foo/index.js"));
    }
}
