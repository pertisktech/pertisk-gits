//! GitLab-style group namespace paths (`a/b/c`).

/// Trim slashes and whitespace from a group path.
pub fn normalize_org_path(path: &str) -> String {
    path.trim().trim_matches('/').to_string()
}

/// Split a git clone path into `(group_full_path, repo_slug)` using the last `/`.
pub fn split_git_repo_path(path: &str) -> Option<(&str, &str)> {
    let path = path.trim().trim_start_matches('/');
    let path = path.strip_suffix(".git").unwrap_or(path);
    let (group, repo) = path.rsplit_once('/')?;
    if group.is_empty() || repo.is_empty() {
        return None;
    }
    Some((group, repo))
}

/// Parent full path of `a/b/c` → `Some("a/b")`; root group → `None`.
pub fn parent_org_path(full_path: &str) -> Option<String> {
    let full_path = normalize_org_path(full_path);
    let (parent, _) = full_path.rsplit_once('/')?;
    if parent.is_empty() {
        return None;
    }
    Some(parent.to_string())
}

/// Local slug (last segment) of `a/b/c` → `c`.
pub fn org_path_slug(full_path: &str) -> &str {
    full_path
        .trim_matches('/')
        .rsplit_once('/')
        .map(|(_, slug)| slug)
        .unwrap_or(full_path.trim_matches('/'))
}

/// Join parent path and child slug → `a/b`.
pub fn join_org_path(parent: &str, slug: &str) -> String {
    let parent = normalize_org_path(parent);
    let slug = slug.trim_matches('/');
    if parent.is_empty() {
        slug.to_string()
    } else if slug.is_empty() {
        parent
    } else {
        format!("{parent}/{slug}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_nested_git_path() {
        assert_eq!(
            split_git_repo_path("a/b/c/repo.git"),
            Some(("a/b/c", "repo"))
        );
        assert_eq!(
            split_git_repo_path("acme/widget"),
            Some(("acme", "widget"))
        );
    }

    #[test]
    fn parent_and_slug() {
        assert_eq!(parent_org_path("a/b/c"), Some("a/b".into()));
        assert_eq!(parent_org_path("a"), None);
        assert_eq!(org_path_slug("a/b/c"), "c");
    }
}
