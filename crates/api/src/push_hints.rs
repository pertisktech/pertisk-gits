use pertisk_git::RefUpdate;
use sqlx::PgPool;
use uuid::Uuid;

const ZERO_SHA: &str = "0000000000000000000000000000000000000000";

pub async fn build_merge_request_push_hints(
    pool: &PgPool,
    public_base_url: &str,
    repo_id: Uuid,
    org_path: &str,
    repo_slug: &str,
    updates: &[RefUpdate],
) -> Result<Vec<String>, sqlx::Error> {
    let default_branch = sqlx::query_scalar::<_, String>(
        r#"SELECT default_branch FROM repositories WHERE id = $1"#,
    )
    .bind(repo_id)
    .fetch_optional(pool)
    .await?
    .unwrap_or_else(|| "main".into());

    let base = public_base_url.trim_end_matches('/');
    let mut hints = Vec::new();

    for update in updates {
        let Some(branch) = update.ref_name.strip_prefix("refs/heads/") else {
            continue;
        };
        if update.new_sha == ZERO_SHA {
            continue;
        }
        if branch == default_branch {
            continue;
        }

        let open_pr = sqlx::query_scalar::<_, i32>(
            r#"
            SELECT number
            FROM pull_requests
            WHERE repository_id = $1
              AND state = 'open'
              AND source_branch = $2
            ORDER BY number
            LIMIT 1
            "#,
        )
        .bind(repo_id)
        .bind(branch)
        .fetch_optional(pool)
        .await?;

        if let Some(number) = open_pr {
            let url = format!("{base}/groups/{org_path}/projects/{repo_slug}/pulls/{number}");
            hints.push(format!(
                "\nView merge request for {branch}:\n  {url}\n\n"
            ));
        } else {
            let source = urlencoding::encode(branch);
            let url = format!(
                "{base}/groups/{org_path}/projects/{repo_slug}/pulls/new?merge_request%5Bsource_branch%5D={source}"
            );
            hints.push(format!(
                "\nTo create a merge request for {branch}, visit:\n  {url}\n\n"
            ));
        }
    }

    Ok(hints)
}

pub fn new_merge_request_url(public_base_url: &str, org_path: &str, repo_slug: &str, branch: &str) -> String {
    let base = public_base_url.trim_end_matches('/');
    let source = urlencoding::encode(branch);
    format!(
        "{base}/groups/{org_path}/projects/{repo_slug}/pulls/new?merge_request%5Bsource_branch%5D={source}"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zero_sha_constant_is_valid() {
        assert_eq!(ZERO_SHA.len(), 40);
    }

    #[test]
    fn new_merge_request_url_uses_gitlab_style_query() {
        let url = new_merge_request_url(
            "https://gitdev.tools.pertisk.com",
            "pertisktech",
            "pertisk-rproxy",
            "unit-test",
        );
        assert!(url.contains("/pulls/new?"));
        assert!(url.contains("merge_request%5Bsource_branch%5D=unit-test"));
    }

    #[test]
    fn merge_request_hint_message_is_multiline() {
        let msg = format!(
            "\nTo create a merge request for unit-test, visit:\n  https://example.com/pulls/new\n\n"
        );
        assert!(msg.starts_with('\n'));
        assert!(msg.contains("visit:\n  https://"));
    }
}
