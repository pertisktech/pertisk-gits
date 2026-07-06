fn package_version() -> String {
    if let Ok(version) = std::env::var("PERTISK_VERSION") {
        let version = version.trim().trim_start_matches('v').to_string();
        if !version.is_empty() {
            return version;
        }
    }
    std::env::var("CARGO_PKG_VERSION").unwrap_or_else(|_| "0.0.0".into())
}

fn main() {
    let app_version = package_version();
    println!("cargo:rustc-env=PERTISK_APP_VERSION={app_version}");
    println!("cargo:rerun-if-env-changed=PERTISK_VERSION");
    println!("cargo:rerun-if-changed=build.rs");
}
