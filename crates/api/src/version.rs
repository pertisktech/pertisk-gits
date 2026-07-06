use std::path::Path;
use std::sync::OnceLock;

/// Release version baked in at compile time (`PERTISK_VERSION` via build.rs).
pub const APP_VERSION: &str = env!("PERTISK_APP_VERSION");

/// Toolchain used to build this binary (`rustc --version` at compile time).
pub const RUSTC_VERSION: &str = env!("PERTISK_RUSTC_VERSION");

static DISPLAY_VERSION: OnceLock<String> = OnceLock::new();

fn read_version_file(path: &Path) -> Option<String> {
    let contents = std::fs::read_to_string(path).ok()?;
    let version = contents.trim().trim_start_matches('v');
    (!version.is_empty()).then(|| version.to_string())
}

/// Resolve the version shown in `/health` and admin UI.
///
/// Prefers `PERTISK_VERSION` at runtime, then `web/dist/.app-version` (same
/// stamp as the embedded UI build), then the compile-time version.
pub fn init_display_version(web_dist: Option<&Path>) {
    DISPLAY_VERSION.get_or_init(|| {
        if let Ok(version) = std::env::var("PERTISK_VERSION") {
            let version = version.trim().trim_start_matches('v');
            if !version.is_empty() {
                return version.to_string();
            }
        }

        if let Some(dist) = web_dist {
            if let Some(version) = read_version_file(&dist.join(".app-version")) {
                return version;
            }
        }

        APP_VERSION.to_string()
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
}
