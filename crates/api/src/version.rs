/// Release version from `PERTISK_VERSION` at compile time (package/deploy VERSION),
/// otherwise the workspace version from Cargo.toml.
pub const APP_VERSION: &str = match option_env!("PERTISK_VERSION") {
    Some(version) => version,
    None => env!("CARGO_PKG_VERSION"),
};
