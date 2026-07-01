use std::fmt::Write;

#[derive(Debug, Clone)]
pub struct EmailContent {
    pub headline: String,
    pub paragraphs: Vec<String>,
    pub action_label: Option<String>,
    pub action_url: Option<String>,
}

impl EmailContent {
    pub fn simple(headline: impl Into<String>, paragraphs: Vec<String>) -> Self {
        Self {
            headline: headline.into(),
            paragraphs,
            action_label: None,
            action_url: None,
        }
    }

    pub fn with_action(
        headline: impl Into<String>,
        paragraphs: Vec<String>,
        action_label: impl Into<String>,
        action_url: impl Into<String>,
    ) -> Self {
        Self {
            headline: headline.into(),
            paragraphs,
            action_label: Some(action_label.into()),
            action_url: Some(action_url.into()),
        }
    }
}

pub fn render_plain(base_url: &str, from_name: &str, content: &EmailContent) -> String {
    let mut body = String::new();
    let _ = writeln!(body, "{}\n", content.headline);
    for paragraph in &content.paragraphs {
        let _ = writeln!(body, "{paragraph}\n");
    }
    if let (Some(label), Some(url)) = (&content.action_label, &content.action_url) {
        let _ = writeln!(body, "{label}: {url}\n");
    }
    let _ = writeln!(body, "---");
    let _ = writeln!(body, "{from_name}");
    let _ = write!(body, "{base_url}");
    body
}

pub fn render_html(base_url: &str, from_name: &str, content: &EmailContent) -> String {
    let base_url = base_url.trim_end_matches('/');
    let logo_url = format!("{base_url}/logo.png");
    let headline = html_escape(&content.headline);
    let from_name = html_escape(from_name);
    let base_url_esc = html_escape(base_url);

    let mut paragraphs = String::new();
    for paragraph in &content.paragraphs {
        paragraphs.push_str(&format!(
            r#"<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#3f3f46;">{}</p>"#,
            html_escape(paragraph)
        ));
    }

    let action = match (&content.action_label, &content.action_url) {
        (Some(label), Some(url)) => format!(
            r#"<table role="presentation" cellspacing="0" cellpadding="0" style="margin:8px 0 24px;">
  <tr>
    <td style="border-radius:8px;background:#6d28d9;">
      <a href="{}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">{}</a>
    </td>
  </tr>
</table>"#,
            html_escape(url),
            html_escape(label)
        ),
        _ => String::new(),
    };

    format!(
        r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light" />
  <title>{headline}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f4f5;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;">
          <tr>
            <td style="padding:0 0 20px;text-align:center;">
              <a href="{base_url_esc}" style="text-decoration:none;display:inline-block;">
                <img src="{logo_url}" alt="{from_name}" height="44" style="display:block;height:44px;width:auto;border:0;" />
              </a>
            </td>
          </tr>
          <tr>
            <td style="background:#ffffff;border:1px solid #e4e4e7;border-radius:14px;padding:28px 28px 24px;">
              <h1 style="margin:0 0 18px;font-size:22px;line-height:1.3;font-weight:700;color:#18181b;">{headline}</h1>
              {paragraphs}
              {action}
            </td>
          </tr>
          <tr>
            <td style="padding:20px 8px 0;text-align:center;font-size:12px;line-height:1.5;color:#71717a;">
              <p style="margin:0 0 6px;">{from_name}</p>
              <p style="margin:0;">
                <a href="{base_url_esc}" style="color:#6d28d9;text-decoration:none;">{base_url_esc}</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>"#
    )
}

pub fn sample_content(kind: &str, base_url: &str) -> (String, EmailContent) {
    let base_url = base_url.trim_end_matches('/');
    match kind {
        "registration_pending" => (
            "Pertisk Gits registration received".into(),
            EmailContent::with_action(
                "Registration received",
                vec![
                    "Hi @jane,".into(),
                    "Your account was created and is awaiting administrator approval. You will receive another email when your account is approved.".into(),
                ],
                "Sign in",
                format!("{base_url}/login"),
            ),
        ),
        "registration" => (
            "Welcome to Pertisk Gits".into(),
            EmailContent::with_action(
                "Welcome to Pertisk Gits",
                vec![
                    "Hi @jane,".into(),
                    "Your account was created successfully.".into(),
                ],
                "Sign in",
                format!("{base_url}/login"),
            ),
        ),
        "admin_registration" => (
            "New user registration pending approval".into(),
            EmailContent::with_action(
                "New registration pending",
                vec![
                    "User @jane (jane@example.com) registered and is awaiting approval.".into(),
                ],
                "Review users",
                format!("{base_url}/admin/users"),
            ),
        ),
        "approval" => (
            "Your Pertisk Gits account was approved".into(),
            EmailContent::with_action(
                "Account approved",
                vec![
                    "Hi @jane,".into(),
                    "Your account has been approved. You can now sign in.".into(),
                ],
                "Sign in",
                format!("{base_url}/login"),
            ),
        ),
        "merge_request_opened" => (
            "[demo-app] New pull request #42".into(),
            EmailContent::with_action(
                "New pull request #42",
                vec!["Pull request #42 opened: Fix login redirect".into()],
                "View pull request",
                format!("{base_url}/groups/acme/projects/demo-app/pulls/42"),
            ),
        ),
        "merge_request_merged" => (
            "[demo-app] Pull request #42 merged".into(),
            EmailContent::with_action(
                "Pull request #42 merged",
                vec!["Pull request #42 was merged by @alex: Fix login redirect".into()],
                "View pull request",
                format!("{base_url}/groups/acme/projects/demo-app/pulls/42"),
            ),
        ),
        "pipeline_failed" => (
            "[demo-app] Pipeline failed on main".into(),
            EmailContent::with_action(
                "Pipeline failed on main",
                vec![
                    "Pipeline failed for commit a1b2c3d on main.".into(),
                    "Failed jobs: build, test".into(),
                ],
                "View pipeline run",
                format!("{base_url}/groups/acme/projects/demo-app/pipelines/00000000-0000-0000-0000-000000000001"),
            ),
        ),
        "login" => (
            "New sign-in to Pertisk Gits".into(),
            EmailContent::simple(
                "New sign-in detected",
                vec![
                    "Your account was used to sign in via password.".into(),
                    "If this was not you, change your password immediately.".into(),
                ],
            ),
        ),
        _ => (
            "Pertisk Gits SMTP test".into(),
            EmailContent::with_action(
                "SMTP is configured",
                vec![
                    "This is a test email from your Pertisk Gits instance.".into(),
                    "If you received this message, SMTP delivery is working.".into(),
                ],
                "Open Pertisk Gits",
                base_url.to_string(),
            ),
        ),
    }
}

fn html_escape(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for ch in value.chars() {
        match ch {
            '&' => escaped.push_str("&amp;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            '"' => escaped.push_str("&quot;"),
            '\'' => escaped.push_str("&#39;"),
            _ => escaped.push(ch),
        }
    }
    escaped
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn html_includes_logo_and_url() {
        let html = render_html(
            "https://git.example.com",
            "Pertisk Gits",
            &EmailContent::with_action(
                "Hello",
                vec!["Test body".into()],
                "Open",
                "https://git.example.com/login",
            ),
        );
        assert!(html.contains("https://git.example.com/logo.png"));
        assert!(html.contains("https://git.example.com"));
        assert!(html.contains("Hello"));
    }
}
