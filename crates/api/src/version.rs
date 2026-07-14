use std::path::Path;
use std::sync::OnceLock;

/// Release version baked in at compile time (`PERTISK_VERSION` via build.rs).
pub const APP_VERSION: &str = env!("PERTISK_APP_VERSION");

/// Release flag baked in at compile time (`PERTISK_VERSION` via build.rs).
const APP_VERSION_RELEASE_FLAG: &str = env!("PERTISK_APP_VERSION_IS_RELEASE");

fn app_version_is_release() -> bool {
    APP_VERSION_RELEASE_FLAG == "1"
}

/// Toolchain used to build this binary (`rustc --version` at compile time).
pub const RUSTC_VERSION: &str = env!("PERTISK_RUSTC_VERSION");

static DISPLAY_VERSION: OnceLock<String> = OnceLock::new();

fn normalize_version(version: &str) -> &str {
    version.trim().trim_start_matches('v')
}

fn read_version_file(path: &Path) -> Option<String> {
    let contents = std::fs::read_to_string(path).ok()?;
    let version = normalize_version(&contents);
    (!version.is_empty()).then(|| version.to_string())
}

pub fn resolve_display_version(
    runtime_version: Option<&str>,
    app_version: &str,
    app_version_is_release: bool,
    web_dist_version: Option<&str>,
) -> String {
    if let Some(version) = runtime_version {
        let version = normalize_version(version);
        if !version.is_empty() {
            return version.to_string();
        }
    }

    if app_version_is_release {
        return app_version.to_string();
    }

    if let Some(version) = web_dist_version {
        return version.to_string();
    }

    app_version.to_string()
}

/// Resolve the version shown in `/health` and admin UI.
///
/// Prefers `PERTISK_VERSION` at runtime, then the compile-time release version
/// when the binary was built with `PERTISK_VERSION`, then `web/dist/.app-version`
/// (dev UI stamp), then the compile-time package version.
pub fn init_display_version(web_dist: Option<&Path>) {
    DISPLAY_VERSION.get_or_init(|| {
        let web_dist_version = web_dist
            .and_then(|dist| read_version_file(&dist.join(".app-version")));
        let runtime_version = std::env::var("PERTISK_VERSION").ok();
        resolve_display_version(
            runtime_version.as_deref(),
            APP_VERSION,
            app_version_is_release(),
            web_dist_version.as_deref(),
        )
    });
}

pub fn display_version() -> &'static str {
    DISPLAY_VERSION
        .get()
        .map(String::as_str)
        .unwrap_or(APP_VERSION)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_version_is_non_empty() {
        assert!(!APP_VERSION.is_empty());
        assert!(!RUSTC_VERSION.is_empty());
    }

    #[test]
    fn release_build_prefers_compile_time_version_over_web_stamp() {
        let version = resolve_display_version(
            None,
            "0.4.18",
            true,
            Some("0.2.19-182-gef045be"),
        );
        assert_eq!(version, "0.4.18");
    }

    #[test]
    fn dev_build_prefers_web_stamp_over_package_version() {
        let version = resolve_display_version(
            None,
            "0.1.0",
            false,
            Some("0.2.19-182-gef045be"),
        );
        assert_eq!(version, "0.2.19-182-gef045be");
    }

    #[test]
    fn runtime_version_overrides_release_build() {
        let version = resolve_display_version(
            Some("9.9.9"),
            "0.4.18",
            true,
            Some("0.2.19-182-gef045be"),
        );
        assert_eq!(version, "9.9.9");
    }
}
