use crate::pattern::glob_match;

pub const CI_ENVIRONMENTS: &[&str] = &["dev", "qa", "uat", "prd"];

/// Infer deploy environment from branch or release tag (main → dev, qa → qa, release/* → prd).
pub fn infer_environment_from_ref(branch: Option<&str>, tag: Option<&str>) -> Option<String> {
    if let Some(tag_name) = tag {
        if glob_match("release/*", tag_name) {
            return Some("prd".into());
        }
        return None;
    }
    match branch {
        Some("main") => Some("dev".into()),
        Some("qa") => Some("qa".into()),
        Some("uat") => Some("uat".into()),
        _ => None,
    }
}

/// Normalize user/API environment input (accepts prod → prd).
pub fn normalize_environment(raw: &str) -> Option<String> {
    let lower = raw.trim().to_ascii_lowercase();
    if lower.is_empty() {
        return None;
    }
    let normalized = match lower.as_str() {
        "prod" | "production" => "prd",
        other if CI_ENVIRONMENTS.contains(&other) => other,
        _ => return None,
    };
    Some(normalized.to_string())
}

/// Effective environment for secret resolution on a job.
pub fn effective_job_environment(
    job_environment: Option<&str>,
    run_environment: Option<&str>,
    job_name: &str,
) -> Option<String> {
    if let Some(env) = job_environment {
        return normalize_environment(env).or_else(|| Some(env.to_string()));
    }
    if let Some(env) = run_environment {
        return Some(env.to_string());
    }
    infer_environment_from_job_name(job_name)
}

fn infer_environment_from_job_name(job_name: &str) -> Option<String> {
    for env in CI_ENVIRONMENTS {
        if job_name.ends_with(&format!("-{env}")) {
            return Some((*env).to_string());
        }
    }
    if job_name.ends_with("-prod") {
        return Some("prd".into());
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn infers_environment_from_branch() {
        assert_eq!(infer_environment_from_ref(Some("main"), None).as_deref(), Some("dev"));
        assert_eq!(infer_environment_from_ref(Some("qa"), None).as_deref(), Some("qa"));
        assert_eq!(infer_environment_from_ref(None, Some("release/1.0.0")).as_deref(), Some("prd"));
    }

    #[test]
    fn normalizes_prod_alias() {
        assert_eq!(normalize_environment("prod").as_deref(), Some("prd"));
    }
}
