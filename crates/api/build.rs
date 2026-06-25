fn main() {
    let version = std::process::Command::new(std::env::var("RUSTC").unwrap_or_else(|_| "rustc".into()))
        .arg("--version")
        .output()
        .ok()
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty())
        .unwrap_or_else(|| "unknown".into());

    println!("cargo:rustc-env=PERTISK_RUSTC_VERSION={version}");
    println!("cargo:rerun-if-changed=build.rs");
}
