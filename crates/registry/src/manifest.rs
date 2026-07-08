/// Total compressed image size (config + layers) from a Docker/OCI image manifest payload.
pub fn image_total_size_bytes(payload: &[u8]) -> i64 {
    let Ok(value) = serde_json::from_slice::<serde_json::Value>(payload) else {
        return payload.len() as i64;
    };

    let mut total = 0i64;

    if let Some(size) = value
        .get("config")
        .and_then(|c| c.get("size"))
        .and_then(|s| s.as_i64())
    {
        total += size;
    }

    if let Some(layers) = value.get("layers").and_then(|l| l.as_array()) {
        for layer in layers {
            if let Some(size) = layer.get("size").and_then(|s| s.as_i64()) {
                total += size;
            }
        }
    }

    if total > 0 {
        total
    } else {
        payload.len() as i64
    }
}

/// Platforms declared in a Docker/OCI manifest index payload.
///
/// For single-image manifests (without a `manifests` array), returns an empty list.
pub fn index_platforms(payload: &[u8]) -> Vec<String> {
    let Ok(value) = serde_json::from_slice::<serde_json::Value>(payload) else {
        return Vec::new();
    };

    let Some(entries) = value.get("manifests").and_then(|m| m.as_array()) else {
        return Vec::new();
    };

    let mut out = Vec::new();
    for entry in entries {
        let Some(platform) = entry.get("platform") else {
            continue;
        };
        let Some(os) = platform.get("os").and_then(|v| v.as_str()) else {
            continue;
        };
        let Some(arch) = platform.get("architecture").and_then(|v| v.as_str()) else {
            continue;
        };
        let mut label = format!("{os}/{arch}");
        if let Some(variant) = platform.get("variant").and_then(|v| v.as_str()) {
            label.push('/');
            label.push_str(variant);
        }
        if !out.iter().any(|v| v == &label) {
            out.push(label);
        }
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sums_config_and_layer_sizes() {
        let payload = br#"{
            "schemaVersion": 2,
            "config": { "size": 1234, "digest": "sha256:abc" },
            "layers": [
                { "size": 33320993, "digest": "sha256:layer1" },
                { "size": 29785419, "digest": "sha256:layer2" }
            ]
        }"#;
        assert_eq!(image_total_size_bytes(payload), 1234 + 33320993 + 29785419);
    }

    #[test]
    fn falls_back_to_payload_length_when_no_sizes() {
        let payload = br#"{"schemaVersion": 2}"#;
        assert_eq!(image_total_size_bytes(payload), payload.len() as i64);
    }

    #[test]
    fn invalid_json_uses_payload_length() {
        assert_eq!(image_total_size_bytes(b"not-json"), 8);
    }

    #[test]
    fn extracts_index_platforms() {
        let payload = br#"{
            "schemaVersion": 2,
            "mediaType": "application/vnd.oci.image.index.v1+json",
            "manifests": [
                {
                    "mediaType": "application/vnd.oci.image.manifest.v1+json",
                    "digest": "sha256:a",
                    "size": 123,
                    "platform": { "os": "linux", "architecture": "amd64" }
                },
                {
                    "mediaType": "application/vnd.oci.image.manifest.v1+json",
                    "digest": "sha256:b",
                    "size": 123,
                    "platform": { "os": "linux", "architecture": "arm64" }
                }
            ]
        }"#;

        assert_eq!(index_platforms(payload), vec!["linux/amd64", "linux/arm64"]);
    }

    #[test]
    fn single_manifest_has_no_index_platforms() {
        let payload = br#"{
            "schemaVersion": 2,
            "mediaType": "application/vnd.oci.image.manifest.v1+json",
            "config": { "size": 1234 },
            "layers": [{ "size": 5678 }]
        }"#;

        assert!(index_platforms(payload).is_empty());
    }
}
