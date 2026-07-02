use std::collections::HashMap;

use crate::config::Step;

fn parse_ci_ref(rest: &str, prefix: &str) -> Option<(String, usize)> {
    let trimmed = rest.trim_start();
    let skip = rest.len() - trimmed.len();
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

fn resolve_refs(input: &str, prefix: &str, values: &HashMap<String, String>) -> String {
    let mut out = String::with_capacity(input.len());
    let bytes = input.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if let Some(rest) = input[i..].strip_prefix("${{") {
            if let Some((name, consumed)) = parse_ci_ref(rest, prefix) {
                if let Some(value) = values.get(&name) {
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

/// Replace `${{ secrets.NAME }}` references in pipeline strings.
pub fn resolve_secret_refs(input: &str, secrets: &HashMap<String, String>) -> String {
    resolve_refs(input, "secrets.", secrets)
}

/// Replace `${{ vars.NAME }}` references in pipeline strings.
pub fn resolve_var_refs(input: &str, variables: &HashMap<String, String>) -> String {
    resolve_refs(input, "vars.", variables)
}

/// Resolve secret and variable references in a step's `run` script and `env` values.
pub fn apply_ci_config_to_step(
    step: &Step,
    secrets: &HashMap<String, String>,
    variables: &HashMap<String, String>,
) -> Step {
    let resolve = |input: &str| resolve_var_refs(&resolve_secret_refs(input, secrets), variables);
    let mut out = step.clone();
    out.run = resolve(&step.run);
    out.env = step
        .env
        .iter()
        .map(|(key, value)| (key.clone(), resolve(value)))
        .collect();
    out
}

/// Backward-compatible alias when all values live in one map.
pub fn apply_secrets_to_step(step: &Step, secrets: &HashMap<String, String>) -> Step {
    apply_ci_config_to_step(step, secrets, &HashMap::new())
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
    use crate::config::Step;

    #[test]
    fn resolves_secret_syntax() {
        let mut secrets = HashMap::new();
        secrets.insert("API_TOKEN".into(), "sekret".into());
        let resolved = resolve_secret_refs("curl -H 'Authorization: Bearer ${{ secrets.API_TOKEN }}'", &secrets);
        assert_eq!(resolved, "curl -H 'Authorization: Bearer sekret'");
    }

    #[test]
    fn resolves_var_syntax() {
        let mut variables = HashMap::new();
        variables.insert("SONAR_HOST_URL".into(), "https://sonar.example.com".into());
        let resolved = resolve_var_refs("open ${{ vars.SONAR_HOST_URL }}/dashboard", &variables);
        assert_eq!(resolved, "open https://sonar.example.com/dashboard");
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
    fn apply_ci_config_resolves_both_scopes() {
        let secrets = HashMap::from([("TOKEN".into(), "sekret".into())]);
        let variables = HashMap::from([("SONAR_HOST_URL".into(), "https://sonar.example.com".into())]);
        let step = Step {
            name: None,
            run: "curl ${{ secrets.TOKEN }} ${{ vars.SONAR_HOST_URL }}".into(),
            uses: None,
            working_directory: None,
            env: HashMap::new(),
            with: HashMap::new(),
        };
        let out = apply_ci_config_to_step(&step, &secrets, &variables);
        assert_eq!(out.run, "curl sekret https://sonar.example.com");
    }

    #[test]
    fn masks_secret_values() {
        let masked = mask_secrets_in_text("token=supersecret123 done", &["supersecret123".into()]);
        assert_eq!(masked, "token=*** done");
    }

    #[test]
    fn ignores_invalid_secret_refs() {
        let secrets = HashMap::new();
        assert_eq!(
            resolve_secret_refs("no secret ${{ secrets.bad_name }} here", &secrets),
            "no secret ${{ secrets.bad_name }} here"
        );
        assert_eq!(
            resolve_secret_refs("missing close ${{ secrets.API_TOKEN", &secrets),
            "missing close ${{ secrets.API_TOKEN"
        );
    }

    #[test]
    fn apply_secrets_to_step_rewrites_run_and_env() {
        let mut secrets = HashMap::new();
        secrets.insert("TOKEN".into(), "abc".into());
        let step = Step {
            name: None,
            run: "echo ${{ secrets.TOKEN }}".into(),
            uses: None,
            working_directory: None,
            env: HashMap::from([("AUTH".into(), "${{ secrets.TOKEN }}".into())]),
            with: HashMap::new(),
        };
        let out = apply_secrets_to_step(&step, &secrets);
        assert_eq!(out.run, "echo abc");
        assert_eq!(out.env.get("AUTH").map(String::as_str), Some("abc"));
    }

    #[test]
    fn mask_ignores_short_secrets() {
        let masked = mask_secrets_in_text("key=abc", &["abc".into()]);
        assert_eq!(masked, "key=abc");
    }

    #[test]
    fn secret_resolver_ignores_var_syntax() {
        let secrets = HashMap::new();
        assert_eq!(
            resolve_secret_refs("value=${{ vars.API_TOKEN }}", &secrets),
            "value=${{ vars.API_TOKEN }}"
        );
    }

    #[test]
    fn unknown_var_placeholder_is_removed() {
        let variables = HashMap::new();
        assert_eq!(
            resolve_var_refs("x=${{ vars.MISSING }}", &variables),
            "x="
        );
    }

    #[test]
    fn preserves_multibyte_characters() {
        let secrets = HashMap::new();
        assert_eq!(resolve_secret_refs("café", &secrets), "café");
    }

    #[test]
    fn unknown_secret_placeholder_is_removed() {
        let secrets = HashMap::from([("KNOWN".into(), "value".into())]);
        assert_eq!(
            resolve_secret_refs("x=${{ secrets.MISSING }}", &secrets),
            "x="
        );
    }
}
