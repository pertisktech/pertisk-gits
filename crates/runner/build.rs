fn package_version_with_flag() -> (String, bool) {
    if let Ok(version) = std::env::var("PERTISK_VERSION") {
        let version = version.trim().trim_start_matches('v').to_string();
        if !version.is_empty() {
            return (version, true);
        }
    }
    (
        std::env::var("CARGO_PKG_VERSION").unwrap_or_else(|_| "0.0.0".into()),
        false,
    )
}

fn main() {
    let (app_version, is_release) = package_version_with_flag();
    println!("cargo:rustc-env=PERTISK_APP_VERSION={app_version}");
    println!(
        "cargo:rustc-env=PERTISK_APP_VERSION_IS_RELEASE={}",
        if is_release { "1" } else { "0" }
    );
    println!("cargo:rerun-if-env-changed=PERTISK_VERSION");
    println!("cargo:rerun-if-changed=build.rs");
}
