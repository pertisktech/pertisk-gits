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
