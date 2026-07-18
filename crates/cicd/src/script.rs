use std::collections::HashMap;

use crate::config::{ArtifactDecl, Step};

/// Shell-escape a value for use inside single quotes.
pub fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

/// Prepend `export` lines so `$VAR` references work reliably under `sh -lc`.
pub fn wrap_shell_script_with_env(run: &str, env: &[(&str, String)]) -> String {
    let mut script = String::with_capacity(run.len() + env.len() * 32);
    for (key, value) in env {
        script.push_str("export ");
        script.push_str(key);
        script.push('=');
        script.push_str(&shell_quote(value));
        script.push('\n');
    }
    script.push_str(run);
    script
}

/// Render a bash script that runs pipeline steps (used by the Kubernetes job executor).
pub fn render_job_script(
    project_dir: &str,
    steps: &[Step],
    artifacts: &[ArtifactDecl],
    extra_env: &HashMap<String, String>,
) -> String {
    let mut script = format!(
        r#"#!/bin/sh
set -eu
export CI=true PERTISK_CI=true PYTHONUNBUFFERED=1
export CI_PROJECT_DIR={project_dir}
cd "$CI_PROJECT_DIR"

upload_artifact() {{
  name="$1"
  path="$2"
  echo "=== upload-artifact ${{name}} (running)"
  if [ ! -e "$CI_PROJECT_DIR/$path" ]; then
    echo "artifact path not found: $path"
    return 1
  fi
  tar -czf - -C "$CI_PROJECT_DIR" "$path" | curl -sfS \
    -H "Authorization: Bearer ${{PERTISK_RUNNER_TOKEN}}" \
    -F "name=${{name}}" -F "path=${{path}}" -F "file=@-;filename=${{name}}.tar.gz;type=application/gzip" \
    "${{PERTISK_API_URL}}/api/v1/runner/jobs/${{PERTISK_JOB_ID}}/artifacts"
  code=$?
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
        // The wrapper itself uses `set -e`, but must capture a failed step
        // before exiting so the log always receives its `(exit N)` marker.
        script.push_str("set +e\n");
        script.push_str("(\n");
        script.push_str(&format!("  cd {cwd}\n"));
        for (key, value) in &step.env {
            script.push_str(&format!("  export {}={}\n", key, shell_quote(value)));
        }
        script.push_str(&format!(
            "  if command -v stdbuf >/dev/null 2>&1; then stdbuf -oL -eL sh -c {}; else sh -c {}; fi\n",
            shell_quote(&step.run),
            shell_quote(&step.run)
        ));
        script.push_str(")\n");
        script.push_str("step_exit=$?\n");
        script.push_str("set -e\n");
        script.push_str(&format!(
            "if [ \"$step_exit\" -ne 0 ]; then echo \"=== {step_name} (exit $step_exit)\"; exit \"$step_exit\"; fi\n"
        ));
        script.push_str(&format!("echo \"=== {step_name} (exit 0)\"\n"));
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
    fn wrap_shell_script_with_env_exports_vars() {
        let env = [("CI_JOB_NAME", "build".into())];
        let script = wrap_shell_script_with_env("echo \"$CI_JOB_NAME\"", &env);
        assert!(script.contains("export CI_JOB_NAME='build'"));
        assert!(script.contains("echo \"$CI_JOB_NAME\""));
    }

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
        assert!(script.contains("sh -c 'make build'") || script.contains("stdbuf -oL -eL sh -c 'make build'"));
        assert!(!script.contains("bash -lc"));
        assert!(!script.contains("pushd"));
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

    #[test]
    fn shell_quote_escapes_single_quotes() {
        assert_eq!(shell_quote("plain"), "'plain'");
        assert_eq!(shell_quote("it's"), "'it'\"'\"'s'");
    }

    #[test]
    fn renders_artifact_upload_step() {
        use crate::config::ArtifactDecl;
        let steps = vec![Step {
            name: Some("upload".into()),
            run: String::new(),
            uses: None,
            working_directory: None,
            env: HashMap::new(),
            with: HashMap::new(),
        }];
        let artifacts = vec![ArtifactDecl {
            name: "dist".into(),
            path: "target/*.tar.gz".into(),
        }];
        let script = render_job_script("/workspace", &steps, &artifacts, &HashMap::new());
        assert!(script.contains("target/*.tar.gz"));
    }

    #[test]
    fn renders_upload_artifact_uses_step() {
        let mut with = HashMap::new();
        with.insert("name".into(), "report".into());
        with.insert("path".into(), "out/report.xml".into());
        let steps = vec![Step {
            name: Some("upload".into()),
            run: String::new(),
            uses: Some("upload-artifact".into()),
            working_directory: None,
            env: HashMap::new(),
            with,
        }];
        let script = render_job_script("/workspace", &steps, &[], &HashMap::new());
        assert!(script.contains("upload_artifact 'report' 'out/report.xml'"));
    }

    #[test]
    fn renders_step_with_subdirectory_and_extra_env() {
        let mut step_env = HashMap::new();
        step_env.insert("FOO".into(), "bar".into());
        let steps = vec![Step {
            name: Some("build".into()),
            run: "make".into(),
            uses: None,
            working_directory: Some("pkg".into()),
            env: step_env,
            with: HashMap::new(),
        }];
        let extra = HashMap::from([("GLOBAL".into(), "1".into())]);
        let script = render_job_script("/workspace", &steps, &[], &extra);
        assert!(script.contains("cd $CI_PROJECT_DIR/pkg"));
        assert!(script.contains("export FOO='bar'"));
        assert!(script.contains("export GLOBAL='1'"));
    }
}
