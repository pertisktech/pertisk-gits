//! Detect repository languages from tracked file extensions (GitHub-style).

use std::collections::HashMap;
use std::path::Path;

use serde::Serialize;

use crate::explorer::{self, RefKind};

#[derive(Debug, Clone, Serialize)]
pub struct LanguageStat {
    pub name: String,
    pub bytes: u64,
    pub percent: f64,
    pub color: String,
}

/// Map file path → display language name. Returns None for ignored/vendor noise.
pub fn language_from_path(path: &str) -> Option<&'static str> {
    let file_name = path.rsplit('/').next().unwrap_or(path).to_lowercase();

    if matches!(
        file_name.as_str(),
        "license"
            | "licence"
            | "copying"
            | "dockerfile"
            | "makefile"
            | "gemfile"
            | "rakefile"
            | "procfile"
    ) {
        return match file_name.as_str() {
            "dockerfile" => Some("Dockerfile"),
            "makefile" => Some("Makefile"),
            _ => None,
        };
    }

    // Skip generated / lock / binary-ish names
    if file_name.ends_with(".min.js")
        || file_name.ends_with(".min.css")
        || file_name.ends_with(".map")
        || file_name == "package-lock.json"
        || file_name == "pnpm-lock.yaml"
        || file_name == "yarn.lock"
        || file_name == "cargo.lock"
        || file_name == "go.sum"
        || file_name == "composer.lock"
    {
        return None;
    }

    let ext = file_name.rsplit_once('.').map(|(_, e)| e)?;

    Some(match ext {
        "rs" => "Rust",
        "go" => "Go",
        "ts" | "tsx" | "mts" | "cts" => "TypeScript",
        "js" | "jsx" | "mjs" | "cjs" => "JavaScript",
        "py" | "pyi" => "Python",
        "java" => "Java",
        "kt" | "kts" => "Kotlin",
        "swift" => "Swift",
        "c" | "h" => "C",
        "cpp" | "cc" | "cxx" | "hpp" | "hh" => "C++",
        "cs" => "C#",
        "rb" => "Ruby",
        "php" => "PHP",
        "scala" => "Scala",
        "sh" | "bash" | "zsh" | "fish" => "Shell",
        "yml" | "yaml" => "YAML",
        "json" => "JSON",
        "toml" => "TOML",
        "md" | "markdown" | "mdx" => "Markdown",
        "html" | "htm" => "HTML",
        "css" => "CSS",
        "scss" | "sass" => "SCSS",
        "less" => "Less",
        "sql" => "SQL",
        "graphql" | "gql" => "GraphQL",
        "lua" => "Lua",
        "r" => "R",
        "dart" => "Dart",
        "zig" => "Zig",
        "ex" | "exs" => "Elixir",
        "erl" | "hrl" => "Erlang",
        "hs" => "Haskell",
        "clj" | "cljs" | "cljc" => "Clojure",
        "vue" => "Vue",
        "svelte" => "Svelte",
        "tf" | "hcl" => "HCL",
        "proto" => "Protocol Buffer",
        "xml" => "XML",
        "dockerfile" => "Dockerfile",
        _ => return None,
    })
}

pub fn language_color(name: &str) -> &'static str {
    match name {
        "Rust" => "#DEA584",
        "Go" => "#00ADD8",
        "TypeScript" => "#3178C6",
        "JavaScript" => "#F1E05A",
        "Python" => "#3572A5",
        "Java" => "#B07219",
        "Kotlin" => "#A97BFF",
        "Swift" => "#F05138",
        "C" => "#555555",
        "C++" => "#F34B7D",
        "C#" => "#178600",
        "Ruby" => "#701516",
        "PHP" => "#4F5D95",
        "Scala" => "#C22D40",
        "Shell" => "#89E051",
        "YAML" => "#CB171E",
        "JSON" => "#292929",
        "TOML" => "#9C4221",
        "Markdown" => "#083FA1",
        "HTML" => "#E34C26",
        "CSS" => "#563D7C",
        "SCSS" => "#C6538C",
        "Less" => "#1D365D",
        "SQL" => "#E38C00",
        "GraphQL" => "#E10098",
        "Lua" => "#000080",
        "R" => "#198CE7",
        "Dart" => "#00B4AB",
        "Zig" => "#EC915C",
        "Elixir" => "#6E4A7E",
        "Erlang" => "#B83998",
        "Haskell" => "#5E5086",
        "Clojure" => "#DB5855",
        "Vue" => "#41B883",
        "Svelte" => "#FF3E00",
        "HCL" => "#844FBA",
        "Protocol Buffer" => "#EDE7F6",
        "XML" => "#0060AC",
        "Dockerfile" => "#384D54",
        "Makefile" => "#427819",
        _ => "#8B949E",
    }
}

/// Analyze languages from a recursive `git ls-tree -r -l` of the given ref.
pub async fn analyze_languages(
    repo_path: &Path,
    ref_name: &str,
    kind: RefKind,
) -> anyhow::Result<Vec<LanguageStat>> {
    if !explorer::ref_exists_kind(repo_path, ref_name, kind).await? {
        return Ok(Vec::new());
    }

    let refspec = match kind {
        RefKind::Branch => format!("refs/heads/{ref_name}"),
        RefKind::Tag => format!("refs/tags/{ref_name}"),
    };

    let output = explorer::git_ls_tree_recursive(repo_path, &refspec).await?;
    let mut bytes_by_lang: HashMap<String, u64> = HashMap::new();

    for line in output.lines() {
        // Format: <mode> <type> <object> <size>\t<path>
        let Some((meta, path)) = line.split_once('\t') else {
            continue;
        };
        let parts: Vec<&str> = meta.split_whitespace().collect();
        if parts.len() < 4 || parts[1] != "blob" {
            continue;
        }
        let Ok(size) = parts[3].parse::<u64>() else {
            continue;
        };
        if size == 0 {
            continue;
        }
        let Some(lang) = language_from_path(path) else {
            continue;
        };
        *bytes_by_lang.entry(lang.to_string()).or_default() += size;
    }

    let total: u64 = bytes_by_lang.values().sum();
    if total == 0 {
        return Ok(Vec::new());
    }

    let mut stats: Vec<LanguageStat> = bytes_by_lang
        .into_iter()
        .map(|(name, bytes)| {
            let percent = (bytes as f64 / total as f64) * 100.0;
            let color = language_color(&name).to_string();
            LanguageStat {
                name,
                bytes,
                percent,
                color,
            }
        })
        .collect();

    stats.sort_by(|a, b| {
        b.bytes
            .cmp(&a.bytes)
            .then_with(|| a.name.cmp(&b.name))
    });

    // Keep top languages; fold tiny leftovers into the last if needed (keep all for now, cap at 12)
    if stats.len() > 12 {
        stats.truncate(12);
        let kept: u64 = stats.iter().map(|s| s.bytes).sum();
        for s in &mut stats {
            s.percent = (s.bytes as f64 / kept as f64) * 100.0;
        }
    }

    Ok(stats)
}

pub fn primary_language(stats: &[LanguageStat]) -> Option<&LanguageStat> {
    stats.first()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_common_extensions() {
        assert_eq!(language_from_path("src/main.rs"), Some("Rust"));
        assert_eq!(language_from_path("pkg/server.go"), Some("Go"));
        assert_eq!(language_from_path("web/App.tsx"), Some("TypeScript"));
        assert_eq!(language_from_path("scripts/deploy.sh"), Some("Shell"));
        assert_eq!(language_from_path("Dockerfile"), Some("Dockerfile"));
        assert_eq!(language_from_path("package-lock.json"), None);
    }
}
