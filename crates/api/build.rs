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

    let rustc_version = std::process::Command::new(std::env::var("RUSTC").unwrap_or_else(|_| "rustc".into()))
        .arg("--version")
        .output()
        .ok()
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty())
        .unwrap_or_else(|| "unknown".into());

    println!("cargo:rustc-env=PERTISK_RUSTC_VERSION={rustc_version}");
    println!("cargo:rerun-if-changed=build.rs");
}
