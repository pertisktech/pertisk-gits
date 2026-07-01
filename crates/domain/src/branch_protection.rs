/// Returns true when `branch` matches a protection `pattern` (`*` wildcard).
pub fn branch_matches_pattern(branch: &str, pattern: &str) -> bool {
    let branch = branch.trim();
    let pattern = pattern.trim();
    if pattern.is_empty() || branch.is_empty() {
        return false;
    }
    if pattern == "*" {
        return true;
    }
    if !pattern.contains('*') {
        return branch == pattern;
    }

    let parts: Vec<&str> = pattern.split('*').collect();
    if parts.is_empty() {
        return true;
    }

    let mut rest = branch;
    if !pattern.starts_with('*') {
        let prefix = parts[0];
        if !rest.starts_with(prefix) {
            return false;
        }
        rest = &rest[prefix.len()..];
    }

    for part in parts.iter().skip(1) {
        if part.is_empty() {
            continue;
        }
        let Some(index) = rest.find(part) else {
            return false;
        };
        rest = &rest[index + part.len()..];
    }

    if pattern.ends_with('*') {
        true
    } else {
        rest.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exact_match() {
        assert!(branch_matches_pattern("main", "main"));
        assert!(!branch_matches_pattern("main", "master"));
    }

    #[test]
    fn wildcard_prefix() {
        assert!(branch_matches_pattern("release/1.0", "release/*"));
        assert!(!branch_matches_pattern("hotfix/1.0", "release/*"));
    }

    #[test]
    fn wildcard_suffix() {
        assert!(branch_matches_pattern("feature/foo", "feature/*"));
    }

    #[test]
    fn star_matches_all() {
        assert!(branch_matches_pattern("anything", "*"));
    }

    #[test]
    fn empty_inputs_rejected() {
        assert!(!branch_matches_pattern("", "main"));
        assert!(!branch_matches_pattern("main", ""));
        assert!(!branch_matches_pattern("", ""));
    }

    #[test]
    fn middle_wildcard() {
        assert!(branch_matches_pattern("feature-foo-bar", "feature-*-bar"));
        assert!(!branch_matches_pattern("feature-foo-baz", "feature-*-bar"));
    }

    #[test]
    fn leading_wildcard() {
        assert!(branch_matches_pattern("v1-hotfix", "*-hotfix"));
    }

    #[test]
    fn whitespace_trimmed() {
        assert!(branch_matches_pattern(" main ", " main "));
    }

    #[test]
    fn suffix_without_trailing_star() {
        assert!(branch_matches_pattern("release-1.0", "release-1.0"));
        assert!(!branch_matches_pattern("release-1.0-extra", "release-1.0"));
    }
}
