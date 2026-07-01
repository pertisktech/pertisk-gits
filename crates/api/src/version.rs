/// Release version from `PERTISK_VERSION` at compile time (package/deploy VERSION),
/// otherwise the workspace version from Cargo.toml.
pub const APP_VERSION: &str = match option_env!("PERTISK_VERSION") {
    Some(version) => version,
    None => env!("CARGO_PKG_VERSION"),
};

/// Toolchain used to build this binary (`rustc --version` at compile time).
pub const RUSTC_VERSION: &str = env!("PERTISK_RUSTC_VERSION");

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_version_is_non_empty() {
        assert!(!APP_VERSION.is_empty());
        assert!(!RUSTC_VERSION.is_empty());
    }
}
