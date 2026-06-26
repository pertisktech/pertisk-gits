use std::collections::HashMap;

use crate::config::{ArtifactDecl, Step};

/// Shell-escape a value for use inside single quotes.
fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

/// Render a bash script that runs pipeline steps (used by the Kubernetes job executor).
pub fn render_job_script(
    project_dir: &str,
    steps: &[Step],
    artifacts: &[ArtifactDecl],
    extra_env: &HashMap<String, String>,
) -> String {
    let mut script = format!(
        r#"#!/usr/bin/env bash
set -euo pipefail
export CI=true PERTISK_CI=true PYTHONUNBUFFERED=1
export CI_PROJECT_DIR={project_dir}
cd "$CI_PROJECT_DIR"

upload_artifact() {{
  local name="$1" path="$2"
  echo "=== upload-artifact ${{name}} (running)"
  if [ ! -e "$CI_PROJECT_DIR/$path" ]; then
    echo "artifact path not found: $path"
    return 1
  fi
  tar -czf - -C "$CI_PROJECT_DIR" "$path" | curl -sfS \
    -H "Authorization: Bearer ${{PERTISK_RUNNER_TOKEN}}" \
    -F "name=${{name}}" -F "path=${{path}}" -F "file=@-;filename=${{name}}.tar.gz;type=application/gzip" \
    "${{PERTISK_API_URL}}/api/v1/runner/jobs/${{PERTISK_JOB_ID}}/artifacts"
  local code=$?
  echo "=== upload-artifact ${{name}} (exit ${{code}})"
  return "$code"
}}

"#,
        project_dir = shell_quote(project_dir)
    );

    for (key, value) in extra_env {
        script.push_str("export ");
        script.push_str(key);
        script.push_str("=");
        script.push_str(&shell_quote(value));
        script.push('\n');
    }

    for (index, step) in steps.iter().enumerate() {
        if step.uses.as_deref() == Some("upload-artifact") {
            let name = step
                .with
                .get("name")
                .cloned()
                .unwrap_or_else(|| "artifact".into());
            let path = step
                .with
                .get("path")
                .cloned()
                .unwrap_or_else(|| name.clone());
            script.push_str(&format!(
                "upload_artifact {} {} || exit $?\n",
                shell_quote(&name),
                shell_quote(&path)
            ));
            continue;
        }

        let step_name = step
            .name
            .clone()
            .unwrap_or_else(|| format!("step-{index}"));
        let cwd = step
            .working_directory
            .as_ref()
            .map(|rel| format!("$CI_PROJECT_DIR/{rel}"))
            .unwrap_or_else(|| "$CI_PROJECT_DIR".into());

        script.push_str(&format!("echo \"=== {step_name} (running)\"\n"));
        script.push_str(&format!("pushd {cwd} >/dev/null\n"));
        for (key, value) in &step.env {
            script.push_str(&format!("export {}={}\n", key, shell_quote(value)));
        }
        // Use bash -c (not -lc): login shells reset PATH via /etc/profile and drop
        // toolchains from official images (golang, rust, node, etc.).
        script.push_str(&format!("bash -c {}\n", shell_quote(&step.run)));
        script.push_str("step_exit=$?\n");
        script.push_str(&format!(
            "if [ \"$step_exit\" -ne 0 ]; then echo \"=== {step_name} (exit $step_exit)\"; popd >/dev/null; exit \"$step_exit\"; fi\n"
        ));
        script.push_str(&format!("echo \"=== {step_name} (exit 0)\"\npopd >/dev/null\n"));
    }

    for artifact in artifacts {
        script.push_str(&format!(
            "upload_artifact {} {} || exit $?\n",
            shell_quote(&artifact.name),
            shell_quote(&artifact.path)
        ));
    }

    script.push_str("echo \"=== job finished (success)\"\n");
    script
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn renders_run_step() {
        let steps = vec![Step {
            name: Some("build".into()),
            run: "make build".into(),
            uses: None,
            working_directory: None,
            env: HashMap::new(),
            with: HashMap::new(),
        }];
        let script = render_job_script("/workspace", &steps, &[], &HashMap::new());
        assert!(script.contains("make build"));
        assert!(script.contains("=== build (running)"));
        assert!(script.contains("bash -c 'make build'"));
        assert!(!script.contains("bash -lc"));
    }

    #[test]
    fn records_step_exit_code() {
        let steps = vec![Step {
            name: Some("test".into()),
            run: "false".into(),
            uses: None,
            working_directory: None,
            env: HashMap::new(),
            with: HashMap::new(),
        }];
        let script = render_job_script("/workspace", &steps, &[], &HashMap::new());
        assert!(script.contains("step_exit=$?"));
        assert!(script.contains("=== test (exit $step_exit)"));
    }
}
