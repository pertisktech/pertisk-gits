use std::collections::HashMap;

use chrono::{DateTime, Utc};

/// Context for GitLab-style predefined CI/CD variables injected into every job.
#[derive(Debug, Clone)]
pub struct PredefinedCiContext {
    pub server_url: String,
    pub pipeline_run_id: String,
    pub pipeline_iid: i64,
    pub pipeline_created_at: DateTime<Utc>,
    pub pipeline_event: String,
    pub config_path: Option<String>,
    pub target_environment: Option<String>,
    pub job_id: String,
    pub job_name: String,
    pub effective_environment: Option<String>,
    pub commit_sha: String,
    pub ref_name: String,
    pub repository_id: String,
    pub repo_name: String,
    pub repo_slug: String,
    pub org_slug: String,
    pub default_branch: String,
    pub pull_request: Option<PullRequestContext>,
    pub runner_id: Option<String>,
    pub job_image: Option<String>,
}

#[derive(Debug, Clone)]
pub struct PullRequestContext {
    pub id: String,
    pub number: i32,
    pub title: String,
    pub source_branch: String,
    pub target_branch: String,
}

/// Build GitLab-style predefined variables (lowest precedence — user secrets override).
pub fn build_predefined_vars(ctx: &PredefinedCiContext) -> HashMap<String, String> {
    let mut vars = HashMap::new();

    let server = ctx.server_url.trim_end_matches('/');
    let project_path = format!("{}/{}", ctx.org_slug, ctx.repo_slug);
    let project_path_slug = slugify(&project_path);
    let pipeline_url = format!("{server}/{project_path}/pipelines/{}", ctx.pipeline_run_id);
    let job_url = format!("{pipeline_url}?job={}", url_encode(&ctx.job_name));
    let project_url = format!("{server}/{project_path}");
    let repository_url = format!("{server}/{project_path}.git");

    let (commit_branch, commit_tag, ref_short) = parse_git_ref(&ctx.ref_name);
    let commit_short_sha = short_sha(&ctx.commit_sha);
    let ref_slug = slugify(ref_short.as_deref().unwrap_or(&ctx.ref_name));
    let job_name_slug = slugify(&ctx.job_name);
    let pipeline_source = map_pipeline_source(&ctx.pipeline_event);
    let job_manual = ctx.pipeline_event == "manual";

    vars.insert("CI".into(), "true".into());
    vars.insert("PERTISK_CI".into(), "true".into());

    vars.insert("CI_PIPELINE_ID".into(), ctx.pipeline_run_id.clone());
    vars.insert("CI_PIPELINE_IID".into(), ctx.pipeline_iid.to_string());
    vars.insert("CI_PIPELINE_URL".into(), pipeline_url);
    vars.insert("CI_PIPELINE_SOURCE".into(), pipeline_source);
    vars.insert(
        "CI_PIPELINE_CREATED_AT".into(),
        ctx.pipeline_created_at.to_rfc3339(),
    );

    vars.insert("CI_JOB_ID".into(), ctx.job_id.clone());
    vars.insert("CI_JOB_NAME".into(), ctx.job_name.clone());
    vars.insert("CI_JOB_NAME_SLUG".into(), job_name_slug);
    vars.insert("CI_JOB_URL".into(), job_url);
    vars.insert(
        "CI_JOB_MANUAL".into(),
        if job_manual { "true" } else { "false" }.into(),
    );
    if let Some(image) = &ctx.job_image {
        vars.insert("CI_JOB_IMAGE".into(), image.clone());
    }

    vars.insert("CI_COMMIT_SHA".into(), ctx.commit_sha.clone());
    vars.insert("CI_COMMIT_SHORT_SHA".into(), commit_short_sha);
    vars.insert("CI_COMMIT_REF_NAME".into(), ref_short.clone().unwrap_or_else(|| ctx.ref_name.clone()));
    vars.insert("CI_COMMIT_REF_SLUG".into(), ref_slug);
    if let Some(branch) = commit_branch {
        vars.insert("CI_COMMIT_BRANCH".into(), branch);
    }
    if let Some(tag) = commit_tag {
        vars.insert("CI_COMMIT_TAG".into(), tag);
    }

    vars.insert("CI_PROJECT_ID".into(), ctx.repository_id.clone());
    vars.insert("CI_PROJECT_NAME".into(), ctx.repo_slug.clone());
    vars.insert("CI_PROJECT_TITLE".into(), ctx.repo_name.clone());
    vars.insert("CI_PROJECT_PATH".into(), project_path.clone());
    vars.insert("CI_PROJECT_PATH_SLUG".into(), project_path_slug);
    vars.insert("CI_PROJECT_NAMESPACE".into(), ctx.org_slug.clone());
    vars.insert("CI_PROJECT_URL".into(), project_url);
    vars.insert("CI_REPOSITORY_URL".into(), repository_url);
    vars.insert(
        "CI_REPOSITORY_SLUG".into(),
        format!("{}/{}", ctx.org_slug, ctx.repo_slug),
    );
    vars.insert("CI_DEFAULT_BRANCH".into(), ctx.default_branch.clone());

    if let Some(path) = &ctx.config_path {
        vars.insert("CI_CONFIG_PATH".into(), path.clone());
    }

    vars.insert("CI_SERVER".into(), "yes".into());
    vars.insert("CI_SERVER_URL".into(), server.to_string());
    vars.insert("CI_SERVER_HOST".into(), server_host(server));

    if let Some(env) = ctx
        .effective_environment
        .as_deref()
        .or(ctx.target_environment.as_deref())
    {
        vars.insert("CI_ENVIRONMENT_NAME".into(), env.to_string());
        vars.insert("CI_ENVIRONMENT_SLUG".into(), slugify(env));
    }

    if let Some(pr) = &ctx.pull_request {
        vars.insert("CI_MERGE_REQUEST_ID".into(), pr.id.clone());
        vars.insert("CI_MERGE_REQUEST_IID".into(), pr.number.to_string());
        vars.insert("CI_MERGE_REQUEST_TITLE".into(), pr.title.clone());
        vars.insert(
            "CI_MERGE_REQUEST_SOURCE_BRANCH_NAME".into(),
            pr.source_branch.clone(),
        );
        vars.insert(
            "CI_MERGE_REQUEST_TARGET_BRANCH_NAME".into(),
            pr.target_branch.clone(),
        );
    }

    if let Some(runner_id) = &ctx.runner_id {
        vars.insert("CI_RUNNER_ID".into(), runner_id.clone());
    }

    vars
}

fn parse_git_ref(ref_name: &str) -> (Option<String>, Option<String>, Option<String>) {
    if let Some(branch) = ref_name.strip_prefix("refs/heads/") {
        return (Some(branch.to_string()), None, Some(branch.to_string()));
    }
    if let Some(tag) = ref_name.strip_prefix("refs/tags/") {
        return (None, Some(tag.to_string()), Some(tag.to_string()));
    }
    (Some(ref_name.to_string()), None, Some(ref_name.to_string()))
}

fn short_sha(sha: &str) -> String {
    sha.chars().take(8).collect()
}

fn map_pipeline_source(event: &str) -> String {
    match event {
        "pull_request" => "merge_request_event".into(),
        "manual" => "web".into(),
        "push" => "push".into(),
        other => other.to_string(),
    }
}

fn server_host(url: &str) -> String {
    url.strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))
        .unwrap_or(url)
        .split('/')
        .next()
        .unwrap_or(url)
        .split(':')
        .next()
        .unwrap_or("")
        .to_string()
}

fn slugify(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let mut prev_dash = false;
    for ch in value.chars() {
        let mapped = if ch.is_ascii_alphanumeric() {
            ch.to_ascii_lowercase()
        } else {
            '-'
        };
        if mapped == '-' {
            if prev_dash {
                continue;
            }
            prev_dash = true;
        } else {
            prev_dash = false;
        }
        out.push(mapped);
    }
    out.trim_matches('-').to_string()
}

fn url_encode(value: &str) -> String {
    value
        .bytes()
        .map(|byte| {
            if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
                (byte as char).to_string()
            } else {
                format!("%{byte:02X}")
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn sample_context() -> PredefinedCiContext {
        PredefinedCiContext {
            server_url: "https://git.example.com".into(),
            pipeline_run_id: "11111111-1111-1111-1111-111111111111".into(),
            pipeline_iid: 42,
            pipeline_created_at: Utc.with_ymd_and_hms(2025, 7, 1, 12, 0, 0).unwrap(),
            pipeline_event: "push".into(),
            config_path: Some(".pertisk-ci.yaml".into()),
            target_environment: Some("dev".into()),
            job_id: "22222222-2222-2222-2222-222222222222".into(),
            job_name: "build-docker".into(),
            effective_environment: Some("dev".into()),
            commit_sha: "abcdef1234567890abcdef1234567890abcd".into(),
            ref_name: "refs/heads/main".into(),
            repository_id: "33333333-3333-3333-3333-333333333333".into(),
            repo_name: "My App".into(),
            repo_slug: "my-app".into(),
            org_slug: "acme".into(),
            default_branch: "main".into(),
            pull_request: None,
            runner_id: Some("44444444-4444-4444-4444-444444444444".into()),
            job_image: Some("rust:1-bookworm".into()),
        }
    }

    #[test]
    fn builds_gitlab_style_pipeline_and_job_vars() {
        let vars = build_predefined_vars(&sample_context());
        assert_eq!(
            vars["CI_PIPELINE_ID"],
            "11111111-1111-1111-1111-111111111111"
        );
        assert_eq!(vars["CI_PIPELINE_IID"], "42");
        assert_eq!(
            vars["CI_PIPELINE_URL"],
            "https://git.example.com/acme/my-app/pipelines/11111111-1111-1111-1111-111111111111"
        );
        assert_eq!(vars["CI_PIPELINE_SOURCE"], "push");
        assert_eq!(vars["CI_JOB_ID"], "22222222-2222-2222-2222-222222222222");
        assert_eq!(vars["CI_JOB_NAME"], "build-docker");
        assert_eq!(vars["CI_JOB_NAME_SLUG"], "build-docker");
        assert_eq!(vars["CI_JOB_MANUAL"], "false");
        assert_eq!(vars["CI_JOB_IMAGE"], "rust:1-bookworm");
    }

    #[test]
    fn builds_commit_and_project_vars() {
        let vars = build_predefined_vars(&sample_context());
        assert_eq!(vars["CI_COMMIT_SHA"], "abcdef1234567890abcdef1234567890abcd");
        assert_eq!(vars["CI_COMMIT_SHORT_SHA"], "abcdef12");
        assert_eq!(vars["CI_COMMIT_REF_NAME"], "main");
        assert_eq!(vars["CI_COMMIT_BRANCH"], "main");
        assert!(!vars.contains_key("CI_COMMIT_TAG"));
        assert_eq!(vars["CI_PROJECT_PATH"], "acme/my-app");
        assert_eq!(vars["CI_PROJECT_NAMESPACE"], "acme");
        assert_eq!(vars["CI_DEFAULT_BRANCH"], "main");
        assert_eq!(vars["CI_CONFIG_PATH"], ".pertisk-ci.yaml");
        assert_eq!(vars["CI_ENVIRONMENT_NAME"], "dev");
    }

    #[test]
    fn includes_merge_request_vars_when_present() {
        let mut ctx = sample_context();
        ctx.pipeline_event = "pull_request".into();
        ctx.pull_request = Some(PullRequestContext {
            id: "55555555-5555-5555-5555-555555555555".into(),
            number: 7,
            title: "Add feature".into(),
            source_branch: "feature/x".into(),
            target_branch: "main".into(),
        });
        let vars = build_predefined_vars(&ctx);
        assert_eq!(vars["CI_PIPELINE_SOURCE"], "merge_request_event");
        assert_eq!(vars["CI_MERGE_REQUEST_IID"], "7");
        assert_eq!(vars["CI_MERGE_REQUEST_TITLE"], "Add feature");
        assert_eq!(vars["CI_MERGE_REQUEST_SOURCE_BRANCH_NAME"], "feature/x");
    }

    #[test]
    fn slugify_replaces_special_chars() {
        assert_eq!(slugify("Feature/Branch_Name"), "feature-branch-name");
        assert_eq!(slugify("release/1.0.0"), "release-1-0-0");
        assert_eq!(slugify("--already--"), "already");
    }

    #[test]
    fn tag_ref_and_manual_job_vars() {
        let mut ctx = sample_context();
        ctx.ref_name = "refs/tags/v1.0.0".into();
        ctx.pipeline_event = "manual".into();
        let vars = build_predefined_vars(&ctx);
        assert_eq!(vars["CI_COMMIT_TAG"], "v1.0.0");
        assert!(!vars.contains_key("CI_COMMIT_BRANCH"));
        assert_eq!(vars["CI_JOB_MANUAL"], "true");
        assert_eq!(vars["CI_PIPELINE_SOURCE"], "web");
    }

    #[test]
    fn url_encode_escapes_spaces() {
        assert_eq!(url_encode("a b"), "a%20b");
        assert_eq!(url_encode("plain-token"), "plain-token");
    }

    #[test]
    fn server_host_strips_scheme_and_port() {
        assert_eq!(server_host("https://git.example.com:8443/path"), "git.example.com");
    }

    #[test]
    fn omits_optional_vars_when_not_set() {
        let mut ctx = sample_context();
        ctx.config_path = None;
        ctx.runner_id = None;
        ctx.job_image = None;
        let vars = build_predefined_vars(&ctx);
        assert!(!vars.contains_key("CI_CONFIG_PATH"));
        assert!(!vars.contains_key("CI_RUNNER_ID"));
        assert!(!vars.contains_key("CI_JOB_IMAGE"));
    }
}
