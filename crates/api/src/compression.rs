use tower_http::compression::{
    predicate::{DefaultPredicate, NotForContentType, Predicate},
    CompressionLayer,
};

/// Whether HTTP response compression is enabled (default: true).
pub fn http_compression_enabled() -> bool {
    match std::env::var("HTTP_COMPRESSION") {
        Ok(value) => matches!(
            value.trim(),
            "1" | "true" | "TRUE" | "yes" | "YES" | "on" | "ON"
        ),
        Err(_) => true,
    }
}

/// Response compression with encoding preference zstd > br > gzip (tower-http `Encoding` order).
pub fn compression_layer() -> CompressionLayer<impl Predicate> {
    let predicate = DefaultPredicate::new()
        .and(NotForContentType::const_new(
            "application/x-git-upload-pack-result",
        ))
        .and(NotForContentType::const_new(
            "application/x-git-receive-pack-result",
        ))
        .and(NotForContentType::const_new(
            "application/x-git-upload-pack-advertisement",
        ))
        .and(NotForContentType::const_new(
            "application/x-git-receive-pack-advertisement",
        ))
        .and(NotForContentType::const_new("application/zip"))
        .and(NotForContentType::const_new("application/gzip"));

    CompressionLayer::new()
        .no_deflate()
        .compress_when(predicate)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compression_env_parsing() {
        let previous = std::env::var("HTTP_COMPRESSION").ok();
        std::env::remove_var("HTTP_COMPRESSION");
        assert!(http_compression_enabled());

        std::env::set_var("HTTP_COMPRESSION", "false");
        assert!(!http_compression_enabled());

        std::env::set_var("HTTP_COMPRESSION", "on");
        assert!(http_compression_enabled());

        match previous {
            Some(value) => std::env::set_var("HTTP_COMPRESSION", value),
            None => std::env::remove_var("HTTP_COMPRESSION"),
        }
    }
}
