use std::fmt::Write;

#[derive(Debug, Clone)]
pub struct LoginEmailDetails {
    pub greeting: String,
    pub device_label: String,
    pub device_info: String,
    pub browser: String,
    pub ip_address: String,
    pub location: String,
    pub signed_in_at: String,
    pub sign_in_method: String,
    pub is_mobile: bool,
}

#[derive(Debug, Clone)]
pub struct EmailContent {
    pub headline: String,
    pub paragraphs: Vec<String>,
    pub action_label: Option<String>,
    pub action_url: Option<String>,
    pub login: Option<LoginEmailDetails>,
}

impl EmailContent {
    pub fn simple(headline: impl Into<String>, paragraphs: Vec<String>) -> Self {
        Self {
            headline: headline.into(),
            paragraphs,
            action_label: None,
            action_url: None,
            login: None,
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
            login: None,
        }
    }

    pub fn login_notification(details: LoginEmailDetails) -> Self {
        Self {
            headline: "We Noticed a New Login".into(),
            paragraphs: vec![
                "We noticed a new sign-in to your account.".into(),
                "If this was you, you can safely disregard this email. If this wasn't you, contact your administrator to secure your account.".into(),
            ],
            action_label: None,
            action_url: None,
            login: Some(details),
        }
    }
}

pub fn render_plain(base_url: &str, from_name: &str, content: &EmailContent) -> String {
    if let Some(login) = &content.login {
        return render_login_plain(base_url, from_name, content, login);
    }

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

fn render_login_plain(base_url: &str, from_name: &str, content: &EmailContent, login: &LoginEmailDetails) -> String {
    let mut body = String::new();
    let _ = writeln!(body, "{}\n", content.headline);
    let _ = writeln!(body, "{}\n", login.greeting);
    for paragraph in &content.paragraphs {
        let _ = writeln!(body, "{paragraph}\n");
    }
    let _ = writeln!(body, "{}\n", login.device_label);
    let _ = writeln!(body, "{}\n", login.signed_in_at);
    let _ = writeln!(body, "Device Info:\t{}", login.device_info);
    let _ = writeln!(body, "IP Address:\t{}", login.ip_address);
    let _ = writeln!(body, "Location:\t{}", login.location);
    let _ = writeln!(body, "Browser:\t{}", login.browser);
    let _ = writeln!(body, "Sign-in method:\t{}", login.sign_in_method);
    let _ = writeln!(body, "\n---");
    let _ = writeln!(body, "{from_name}");
    let _ = write!(body, "{}", base_url.trim_end_matches('/'));
    body
}

pub fn render_html(base_url: &str, from_name: &str, content: &EmailContent) -> String {
    if let Some(login) = &content.login {
        return render_login_html(base_url, from_name, content, login);
    }

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

fn render_login_html(
    base_url: &str,
    from_name: &str,
    content: &EmailContent,
    login: &LoginEmailDetails,
) -> String {
    let base_url = base_url.trim_end_matches('/');
    let logo_url = format!("{base_url}/logo.png");
    let headline = html_escape(&content.headline);
    let greeting = html_escape(&login.greeting);
    let from_name_esc = html_escape(from_name);
    let base_url_esc = html_escape(base_url);
    let device_label = html_escape(&login.device_label);
    let signed_in_at = html_escape(&login.signed_in_at);
    let device_info = html_escape(&login.device_info);
    let ip_address = html_escape(&login.ip_address);
    let location = html_escape(&login.location);
    let browser = html_escape(&login.browser);
    let sign_in_method = html_escape(&login.sign_in_method);
    let device_icon = if login.is_mobile { "📱" } else { "💻" };

    let intro = html_escape(
        content
            .paragraphs
            .first()
            .map(String::as_str)
            .unwrap_or("We noticed a login from a device you don't usually use."),
    );
    let footer = html_escape(
        content
            .paragraphs
            .get(1)
            .map(String::as_str)
            .unwrap_or(
                "If this was you, you can safely disregard this email. If this wasn't you, contact your administrator to secure your account.",
            ),
    );

    let browser_row = if login.browser.trim().is_empty() {
        String::new()
    } else {
        format!(
            r#"<tr>
  <td style="padding:8px 0;font-size:14px;color:#71717a;vertical-align:top;width:120px;">Browser:</td>
  <td style="padding:8px 0;font-size:14px;color:#18181b;vertical-align:top;">{browser}</td>
</tr>"#
        )
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
                <img src="{logo_url}" alt="{from_name_esc}" height="44" style="display:block;height:44px;width:auto;border:0;" />
              </a>
            </td>
          </tr>
          <tr>
            <td style="background:#ffffff;border:1px solid #e4e4e7;border-radius:14px;padding:28px 28px 24px;">
              <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;font-weight:700;color:#18181b;">{headline}</h1>
              <p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#3f3f46;">{greeting}</p>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#3f3f46;">{intro}</p>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 20px;background:#fafafa;border:1px solid #e4e4e7;border-radius:12px;">
                <tr>
                  <td style="padding:16px 18px;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                      <tr>
                        <td style="width:40px;vertical-align:top;font-size:24px;line-height:1;">{device_icon}</td>
                        <td style="vertical-align:top;">
                          <p style="margin:0 0 4px;font-size:16px;font-weight:600;color:#18181b;">{device_label}</p>
                          <p style="margin:0;font-size:13px;color:#71717a;">{signed_in_at}</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 20px;">
                <tr>
                  <td style="padding:8px 0;font-size:14px;color:#71717a;vertical-align:top;width:120px;">Device Info:</td>
                  <td style="padding:8px 0;font-size:14px;color:#18181b;vertical-align:top;">{device_info}</td>
                </tr>
                <tr>
                  <td style="padding:8px 0;font-size:14px;color:#71717a;vertical-align:top;">IP Address:</td>
                  <td style="padding:8px 0;font-size:14px;color:#18181b;vertical-align:top;">{ip_address}</td>
                </tr>
                <tr>
                  <td style="padding:8px 0;font-size:14px;color:#71717a;vertical-align:top;">Location:</td>
                  <td style="padding:8px 0;font-size:14px;color:#18181b;vertical-align:top;">{location}</td>
                </tr>
                {browser_row}
                <tr>
                  <td style="padding:8px 0;font-size:14px;color:#71717a;vertical-align:top;">Sign-in method:</td>
                  <td style="padding:8px 0;font-size:14px;color:#18181b;vertical-align:top;">{sign_in_method}</td>
                </tr>
              </table>
              <p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:#3f3f46;">{footer}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 8px 0;text-align:center;font-size:12px;line-height:1.5;color:#71717a;">
              <p style="margin:0 0 6px;">{from_name_esc}</p>
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
            "We Noticed a New Login".into(),
            EmailContent::login_notification(LoginEmailDetails {
                greeting: "Hi,".into(),
                device_label: "OPD2415 (Android16)".into(),
                device_info: "OnePlus OPD2415".into(),
                browser: "Chrome 138.0".into(),
                ip_address: "49.0.72.138".into(),
                location: "Chiang Mai-Chiang Mai,Thailand".into(),
                signed_in_at: "Sun Jul 12 00:16:12 GMT 2026".into(),
                sign_in_method: "Password".into(),
                is_mobile: true,
            }),
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

    #[test]
    fn login_html_includes_device_details() {
        let html = render_html(
            "https://git.example.com",
            "Pertisk Gits",
            &EmailContent::login_notification(LoginEmailDetails {
                greeting: "Hi,".into(),
                device_label: "OPD2415 (Android16)".into(),
                device_info: "OnePlus OPD2415".into(),
                browser: "Chrome 138.0".into(),
                ip_address: "49.0.72.138".into(),
                location: "Chiang Mai-Chiang Mai,Thailand".into(),
                signed_in_at: "Sun Jul 12 00:16:12 GMT 2026".into(),
                sign_in_method: "Password".into(),
                is_mobile: true,
            }),
        );
        assert!(html.contains("We Noticed a New Login"));
        assert!(html.contains("OPD2415 (Android16)"));
        assert!(html.contains("49.0.72.138"));
        assert!(html.contains("Chiang Mai-Chiang Mai,Thailand"));
        assert!(html.contains("Pertisk Gits"));
        assert!(html.contains("https://git.example.com"));
    }

    #[test]
    fn login_plain_includes_app_name_and_url() {
        let plain = render_plain(
            "https://git.example.com",
            "Pertisk Gits",
            &EmailContent::login_notification(LoginEmailDetails {
                greeting: "Hi,".into(),
                device_label: "MacBook Pro".into(),
                device_info: "Apple MacBookPro".into(),
                browser: "Safari 18".into(),
                ip_address: "10.0.0.1".into(),
                location: "Unknown".into(),
                signed_in_at: "Sun Jul 12 00:16:12 GMT 2026".into(),
                sign_in_method: "Password".into(),
                is_mobile: false,
            }),
        );
        assert!(plain.contains("Pertisk Gits"));
        assert!(plain.contains("https://git.example.com"));
    }
}
