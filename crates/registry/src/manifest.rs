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
}
