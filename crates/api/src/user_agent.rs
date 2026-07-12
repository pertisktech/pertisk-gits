#[derive(Debug, Clone)]
pub struct ParsedUserAgent {
    pub device_label: String,
    pub device_info: String,
    pub browser: String,
    pub is_mobile: bool,
}

pub fn parse_user_agent(user_agent: Option<&str>) -> ParsedUserAgent {
    let Some(ua) = user_agent.filter(|s| !s.is_empty()) else {
        return ParsedUserAgent {
            device_label: "Unknown device".into(),
            device_info: "Unknown".into(),
            browser: String::new(),
            is_mobile: false,
        };
    };

    let lower = ua.to_ascii_lowercase();
    let is_mobile = lower.contains("mobile")
        || lower.contains("android")
        || lower.contains("iphone")
        || lower.contains("ipad");

    if let Some(android) = parse_android(ua) {
        return ParsedUserAgent {
            device_label: android.device_label,
            device_info: android.device_info,
            browser: extract_browser(ua),
            is_mobile: true,
        };
    }

    if let Some(apple) = parse_apple(ua) {
        return ParsedUserAgent {
            device_label: apple.device_label,
            device_info: apple.device_info,
            browser: extract_browser(ua),
            is_mobile: apple.is_mobile,
        };
    }

    if lower.contains("windows") {
        let version = extract_after_token(ua, "Windows NT ").unwrap_or("Windows");
        return ParsedUserAgent {
            device_label: format!("Windows ({version})"),
            device_info: "Windows PC".into(),
            browser: extract_browser(ua),
            is_mobile: false,
        };
    }

    if lower.contains("macintosh") || lower.contains("mac os x") {
        return ParsedUserAgent {
            device_label: "macOS".into(),
            device_info: "Apple Mac".into(),
            browser: extract_browser(ua),
            is_mobile: false,
        };
    }

    if lower.contains("linux") {
        return ParsedUserAgent {
            device_label: "Linux".into(),
            device_info: "Linux PC".into(),
            browser: extract_browser(ua),
            is_mobile: false,
        };
    }

    ParsedUserAgent {
        device_label: "Unknown device".into(),
        device_info: "Unknown".into(),
        browser: extract_browser(ua),
        is_mobile,
    }
}

struct AndroidDevice {
    device_label: String,
    device_info: String,
}

fn parse_android(ua: &str) -> Option<AndroidDevice> {
    if !ua.contains("Android") {
        return None;
    }

    let version = extract_after_token(ua, "Android ")
        .and_then(|s| s.split(';').next())
        .map(str::trim)
        .unwrap_or("Unknown");

    let model = ua
        .split(';')
        .nth(2)
        .map(str::trim)
        .filter(|part| !part.is_empty() && !part.starts_with("Build/"))
        .unwrap_or("Android device");

    let manufacturer = guess_manufacturer(model);
    let device_info = if manufacturer.is_empty() {
        model.to_string()
    } else {
        format!("{manufacturer} {model}")
    };

    Some(AndroidDevice {
        device_label: format!("{model} (Android{version})"),
        device_info,
    })
}

struct AppleDevice {
    device_label: String,
    device_info: String,
    is_mobile: bool,
}

fn parse_apple(ua: &str) -> Option<AppleDevice> {
    if ua.contains("iPhone") {
        let ios = extract_ios_version(ua).unwrap_or_else(|| "Unknown".into());
        return Some(AppleDevice {
            device_label: format!("iPhone (iOS {ios})"),
            device_info: "Apple iPhone".into(),
            is_mobile: true,
        });
    }

    if ua.contains("iPad") {
        let ios = extract_ios_version(ua).unwrap_or_else(|| "Unknown".into());
        return Some(AppleDevice {
            device_label: format!("iPad (iOS {ios})"),
            device_info: "Apple iPad".into(),
            is_mobile: true,
        });
    }

    None
}

fn extract_ios_version(ua: &str) -> Option<String> {
    let marker = "CPU iPhone OS ";
    let marker_pad = "CPU OS ";
    let raw = ua
        .split_once(marker)
        .or_else(|| ua.split_once(marker_pad))
        .map(|(_, rest)| rest)?;
    let version = raw.split(' ').next()?.replace('_', ".");
    Some(version)
}

fn guess_manufacturer(model: &str) -> &'static str {
    let upper = model.to_ascii_uppercase();
    if upper.starts_with("OPD") || upper.starts_with("CPH") || upper.starts_with("RMX") {
        "OnePlus"
    } else if upper.starts_with("SM-") || upper.starts_with("GT-") {
        "Samsung"
    } else if upper.starts_with("PIXEL") {
        "Google"
    } else if upper.starts_with("MI ") || upper.starts_with("REDMI") || upper.starts_with("M2") {
        "Xiaomi"
    } else {
        ""
    }
}

fn extract_browser(ua: &str) -> String {
    if let Some(version) = extract_version_after(ua, "Edg/") {
        return format!("Microsoft Edge {version}");
    }
    if let Some(version) = extract_version_after(ua, "Chrome/") {
        if ua.contains("Chromium") {
            return format!("Chromium {version}");
        }
        return format!("Chrome {version}");
    }
    if let Some(version) = extract_version_after(ua, "Firefox/") {
        return format!("Firefox {version}");
    }
    if ua.contains("Safari/") && ua.contains("Version/") {
        if let Some(version) = extract_version_after(ua, "Version/") {
            return format!("Safari {version}");
        }
    }
    String::new()
}

fn extract_version_after(ua: &str, token: &str) -> Option<String> {
    let rest = ua.split_once(token)?.1;
    let version = rest.split_whitespace().next()?.split('.').take(2).collect::<Vec<_>>().join(".");
    if version.is_empty() {
        None
    } else {
        Some(version)
    }
}

fn extract_after_token<'a>(value: &'a str, token: &str) -> Option<&'a str> {
    value
        .split_once(token)
        .map(|(_, rest)| rest.split(';').next().unwrap_or(rest).trim())
}

pub fn is_private_ip(ip: &str) -> bool {
    let ip = ip.trim();
    ip == "::1"
        || ip == "127.0.0.1"
        || ip.starts_with("10.")
        || ip.starts_with("192.168.")
        || ip.starts_with("172.16.")
        || ip.starts_with("172.17.")
        || ip.starts_with("172.18.")
        || ip.starts_with("172.19.")
        || ip.starts_with("172.2")
        || ip.starts_with("172.30.")
        || ip.starts_with("172.31.")
        || ip.starts_with("fc")
        || ip.starts_with("fd")
        || ip.starts_with("fe80:")
}

pub async fn lookup_ip_location(ip: &str) -> Option<String> {
    if is_private_ip(ip) {
        return None;
    }

    let url = format!("http://ip-api.com/json/{ip}?fields=status,city,regionName,country");
    let response = reqwest::Client::new()
        .get(url)
        .timeout(std::time::Duration::from_secs(3))
        .send()
        .await
        .ok()?;
    let payload: serde_json::Value = response.json().await.ok()?;
    if payload.get("status")?.as_str()? != "success" {
        return None;
    }

    let city = payload.get("city").and_then(|v| v.as_str()).unwrap_or("");
    let region = payload
        .get("regionName")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let country = payload.get("country").and_then(|v| v.as_str()).unwrap_or("");

    let location = match (city.is_empty(), region.is_empty(), country.is_empty()) {
        (true, true, true) => return None,
        (false, false, false) => format!("{city}-{region},{country}"),
        (false, true, false) => format!("{city},{country}"),
        (true, false, false) => format!("{region},{country}"),
        (_, _, false) => country.to_string(),
        (false, _, true) => city.to_string(),
        (true, false, true) => region.to_string(),
    };

    Some(location)
}

pub fn format_login_method(method: &str) -> &'static str {
    match method {
        "password" => "Password",
        "oidc" => "Single sign-on (OIDC)",
        "saml" => "Single sign-on (SAML)",
        "ldap" => "LDAP",
        _ => "Sign-in",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_android_user_agent() {
        let ua = "Mozilla/5.0 (Linux; Android 16; OPD2415 Build/UKQ1.231108.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/138.0.7204.67 Mobile Safari/537.36";
        let parsed = parse_user_agent(Some(ua));
        assert!(parsed.device_label.contains("OPD2415"));
        assert!(parsed.device_label.contains("Android16"));
        assert!(parsed.device_info.contains("OnePlus"));
        assert!(parsed.is_mobile);
    }
}
