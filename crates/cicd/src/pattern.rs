pub fn glob_match(pattern: &str, value: &str) -> bool {
    if pattern == "*" {
        return true;
    }
    if let Some(suffix) = pattern.strip_prefix('*') {
        return value.ends_with(suffix);
    }
    if let Some(prefix) = pattern.strip_suffix('*') {
        return value.starts_with(prefix);
    }
    pattern == value
}

pub fn matches_any_pattern(patterns: Option<&[String]>, value: &str) -> bool {
    match patterns {
        None => true,
        Some(list) if list.is_empty() => true,
        Some(list) => list.iter().any(|pattern| glob_match(pattern, value)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn glob_match_star() {
        assert!(glob_match("*", "anything"));
    }

    #[test]
    fn glob_match_prefix_suffix() {
        assert!(glob_match("release/*", "release/1.0"));
        assert!(!glob_match("release/*", "hotfix/1.0"));
        assert!(glob_match("*.md", "README.md"));
        assert!(!glob_match("*.md", "README.txt"));
    }

    #[test]
    fn glob_match_exact() {
        assert!(glob_match("main", "main"));
        assert!(!glob_match("main", "master"));
    }

    #[test]
    fn matches_any_pattern_defaults() {
        assert!(matches_any_pattern(None, "x"));
        assert!(matches_any_pattern(Some(&[]), "x"));
        let patterns = vec!["main".into(), "dev".into()];
        assert!(matches_any_pattern(Some(&patterns), "main"));
        assert!(!matches_any_pattern(Some(&patterns), "feature"));
    }
}
