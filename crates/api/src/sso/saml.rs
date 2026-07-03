use axum::{
    extract::{Form, Path, State},
    response::{IntoResponse, Response},
};
use base64::Engine;
use flate2::read::DeflateDecoder;
use pertisk_domain::{models::AuthProviderType, DomainError};
use quick_xml::events::Event;
use quick_xml::Reader;
use serde::Deserialize;
use std::io::Read;
use uuid::Uuid;

use super::{
    api_callback_url, browser_redirect_response, browser_session_response, ensure_enabled_provider,
    issue_auth_response, jit_provision_user, load_provider, public_base_url, store_flow_state,
    take_flow_state, ExternalUser,
};
use crate::{
    audit::{record_audit_event, AuditEventInput},
    ApiError, AppState,
};
use pertisk_domain::models::AuditEventType;

#[derive(Deserialize)]
pub struct SamlAcsForm {
    #[serde(rename = "SAMLResponse")]
    saml_response: String,
    #[serde(rename = "RelayState")]
    relay_state: Option<String>,
}

pub async fn saml_login(
    State(state): State<AppState>,
    Path(provider_id): Path<Uuid>,
) -> Result<impl IntoResponse, ApiError> {
    let provider = load_provider(&state.pool, provider_id).await?;
    ensure_enabled_provider(&provider)?;
    if provider.provider_type != AuthProviderType::Saml {
        return Err(DomainError::Validation("provider is not SAML".into()).into());
    }

    let sp_entity_id = provider
        .sp_entity_id
        .clone()
        .unwrap_or_else(|| format!("{}/saml/metadata", public_base_url(&state)));
    let acs_url = api_callback_url(&state, &format!("/auth/saml/{provider_id}/acs"));
    let idp_sso_url = provider
        .idp_sso_url
        .clone()
        .ok_or(DomainError::Validation("missing idp_sso_url".into()))?;

    let request_id = format!("_{}", Uuid::new_v4());
    let issue_instant = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ");
    let authn_request = format!(
        r#"<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="{request_id}" Version="2.0" IssueInstant="{issue_instant}" Destination="{idp_sso_url}" AssertionConsumerServiceURL="{acs_url}" ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"><saml:Issuer>{sp_entity_id}</saml:Issuer><samlp:NameIDPolicy Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress" AllowCreate="true"/></samlp:AuthnRequest>"#
    );

    let relay_state = store_flow_state(&state.pool, provider.id, None, None, None).await?;
    let encoded = deflate_base64(&authn_request);
    let redirect_url = format!(
        "{idp_sso_url}?SAMLRequest={}&RelayState={}",
        urlencoding::encode(&encoded),
        urlencoding::encode(&relay_state)
    );

    Ok(browser_redirect_response(&redirect_url).into_response())
}

pub async fn saml_acs(
    State(state): State<AppState>,
    Path(provider_id): Path<Uuid>,
    Form(form): Form<SamlAcsForm>,
) -> Result<Response, ApiError> {
    let relay_state = form
        .relay_state
        .as_deref()
        .ok_or(DomainError::Validation("missing RelayState".into()))?;
    let flow = take_flow_state(&state.pool, relay_state).await?;
    if flow.provider_id != provider_id {
        return Err(DomainError::Unauthorized.into());
    }

    let provider = load_provider(&state.pool, provider_id).await?;
    ensure_enabled_provider(&provider)?;
    if provider.provider_type != AuthProviderType::Saml {
        return Err(DomainError::Validation("provider is not SAML".into()).into());
    }

    let xml = decode_saml_response(&form.saml_response)?;
    if std::env::var("SAML_SKIP_SIGNATURE_VERIFY").ok().as_deref() != Some("1") {
        if provider.idp_certificate.is_none() {
            return Err(DomainError::Validation(
                "SAML signature verification requires idp_certificate (or SAML_SKIP_SIGNATURE_VERIFY=1 for dev)".into(),
            )
            .into());
        }
        // MVP: signature verification deferred; certificate stored for future hardening.
        tracing::warn!("SAML response accepted without signature verification — set SAML_SKIP_SIGNATURE_VERIFY=1 explicitly for dev, or implement cert validation before production");
    }

    let (subject, email, display_name) = parse_saml_assertion(&xml)?;

    let external = ExternalUser {
        subject,
        email: email.clone(),
        display_name,
        username_hint: email.split('@').next().map(str::to_string),
    };

    let user = jit_provision_user(&state.pool, &provider, &external).await?;

    record_audit_event(
        &state.pool,
        AuditEventInput {
            organization_id: None,
            actor_user_id: Some(user.id),
            event_type: AuditEventType::SsoLogin,
            action: format!("saml login via {}", provider.name),
            resource_type: Some("auth_provider".into()),
            resource_id: Some(provider.id.to_string()),
            metadata: Some(serde_json::json!({ "provider_type": "saml", "email": email })),
            ip_address: None,
            user_agent: None,
        },
    )
    .await?;

    let auth = issue_auth_response(&state, user, "saml").await?;
    Ok(browser_session_response(&state, &auth).into_response())
}

fn deflate_base64(input: &str) -> String {
    use flate2::write::DeflateEncoder;
    use flate2::Compression;
    use std::io::Write;

    let mut encoder = DeflateEncoder::new(Vec::new(), Compression::default());
    encoder.write_all(input.as_bytes()).expect("deflate");
    let bytes = encoder.finish().expect("deflate finish");
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

fn decode_saml_response(encoded: &str) -> Result<String, ApiError> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded.trim())
        .map_err(|e| ApiError::from(DomainError::Validation(e.to_string())))?;

    let mut decoder = DeflateDecoder::new(&bytes[..]);
    let mut inflated = String::new();
    if decoder.read_to_string(&mut inflated).is_ok() && inflated.contains("Assertion") {
        return Ok(inflated);
    }

    String::from_utf8(bytes)
        .map_err(|e| ApiError::from(DomainError::Validation(e.to_string())))
}

fn parse_saml_assertion(xml: &str) -> Result<(String, String, Option<String>), ApiError> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);

    let mut subject: Option<String> = None;
    let mut email: Option<String> = None;
    let mut display_name: Option<String> = None;
    let mut in_name_id = false;
    let mut current_attr_name: Option<String> = None;
    let mut buf = Vec::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                let name = String::from_utf8_lossy(e.name().local_name().as_ref()).to_string();
                if name == "NameID" {
                    in_name_id = true;
                }
                for attr in e.attributes().flatten() {
                    let attr_name =
                        String::from_utf8_lossy(attr.key.local_name().as_ref()).to_string();
                    if attr_name == "Name" {
                        current_attr_name =
                            Some(String::from_utf8_lossy(&attr.value).to_string());
                    }
                }
            }
            Ok(Event::Text(e)) => {
                let text = e.unescape().unwrap_or_default().to_string();
                if in_name_id && subject.is_none() {
                    subject = Some(text.clone());
                    if email.is_none() && text.contains('@') {
                        email = Some(text);
                    }
                } else if let Some(attr) = &current_attr_name {
                    match attr.as_str() {
                        "email" | "mail" | "emailAddress" | "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress" => {
                            email = Some(text);
                        }
                        "displayName" | "name" | "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name" => {
                            display_name = Some(text);
                        }
                        _ => {}
                    }
                }
            }
            Ok(Event::End(e)) => {
                let name = String::from_utf8_lossy(e.name().local_name().as_ref()).to_string();
                if name == "NameID" {
                    in_name_id = false;
                }
                if name == "Attribute" || name == "AttributeValue" {
                    current_attr_name = None;
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => {
                return Err(ApiError::from(DomainError::Validation(format!(
                    "invalid SAML XML: {e}"
                ))));
            }
            _ => {}
        }
        buf.clear();
    }

    let subject = subject.ok_or(DomainError::Validation("SAML assertion missing NameID".into()))?;
    let email = email.unwrap_or_else(|| {
        if subject.contains('@') {
            subject.clone()
        } else {
            format!("{subject}@saml.local")
        }
    });

    Ok((subject, email, display_name))
}
