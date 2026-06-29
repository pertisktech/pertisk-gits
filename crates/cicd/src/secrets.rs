use std::collections::HashMap;

use crate::config::Step;

/// Replace `${{ secrets.NAME }}` references in pipeline strings.
pub fn resolve_secret_refs(input: &str, secrets: &HashMap<String, String>) -> String {
    let mut out = String::with_capacity(input.len());
    let bytes = input.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if let Some(rest) = input[i..].strip_prefix("${{") {
            if let Some((name, consumed)) = parse_secret_ref(rest) {
                if let Some(value) = secrets.get(&name) {
                    out.push_str(value);
                }
                i += 3 + consumed;
                continue;
            }
        }
        if let Some(ch) = input[i..].chars().next() {
            out.push(ch);
            i += ch.len_utf8();
        } else {
            break;
        }
    }
    out
}

fn parse_secret_ref(rest: &str) -> Option<(String, usize)> {
    let trimmed = rest.trim_start();
    let skip = rest.len() - trimmed.len();
    let prefix = "secrets.";
    if !trimmed.starts_with(prefix) {
        return None;
    }
    let after = &trimmed[prefix.len()..];
    let name: String = after
        .chars()
        .take_while(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || *c == '_')
        .collect();
    if name.is_empty() || !name.starts_with(|c: char| c.is_ascii_uppercase()) {
        return None;
    }
    let mut end = prefix.len() + name.len();
    let closing = trimmed[end..].trim_start();
    if !closing.starts_with("}}") {
        return None;
    }
    end += trimmed.len() - prefix.len() - name.len() - closing.len() + 2;
    Some((name, skip + end))
}

/// Resolve secret references in a step's `run` script and `env` values.
pub fn apply_secrets_to_step(step: &Step, secrets: &HashMap<String, String>) -> Step {
    let mut out = step.clone();
    out.run = resolve_secret_refs(&step.run, secrets);
    out.env = step
        .env
        .iter()
        .map(|(key, value)| (key.clone(), resolve_secret_refs(value, secrets)))
        .collect();
    out
}

/// Mask secret values in log output (longest values first to avoid partial leaks).
pub fn mask_secrets_in_text(text: &str, secret_values: &[String]) -> String {
    let mut values: Vec<&str> = secret_values
        .iter()
        .map(String::as_str)
        .filter(|v| v.len() >= 4)
        .collect();
    values.sort_by_key(|v| std::cmp::Reverse(v.len()));

    let mut out = text.to_string();
    for value in values {
        if out.contains(value) {
            out = out.replace(value, "***");
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_secret_syntax() {
        let mut secrets = HashMap::new();
        secrets.insert("API_TOKEN".into(), "sekret".into());
        let resolved = resolve_secret_refs("curl -H 'Authorization: Bearer ${{ secrets.API_TOKEN }}'", &secrets);
        assert_eq!(resolved, "curl -H 'Authorization: Bearer sekret'");
    }

    #[test]
    fn resolves_predefined_pipeline_vars() {
        let mut secrets = HashMap::new();
        secrets.insert("CI_PIPELINE_ID".into(), "11111111-1111-1111-1111-111111111111".into());
        secrets.insert("CI_JOB_NAME".into(), "build".into());
        let resolved = resolve_secret_refs(
            "pipeline=${{ secrets.CI_PIPELINE_ID }} job=${{ secrets.CI_JOB_NAME }}",
            &secrets,
        );
        assert_eq!(
            resolved,
            "pipeline=11111111-1111-1111-1111-111111111111 job=build"
        );
    }

    #[test]
    fn masks_secret_values() {
        let masked = mask_secrets_in_text("token=supersecret123 done", &["supersecret123".into()]);
        assert_eq!(masked, "token=*** done");
    }
}
