use ldap3::{LdapConn, Scope, SearchEntry};
use pertisk_domain::{models::AuthProvider, DomainError};

use crate::ApiError;

pub struct LdapUser {
    pub dn: String,
    pub email: String,
    pub display_name: Option<String>,
    pub groups: Vec<String>,
}

pub async fn authenticate_ldap(
    provider: &AuthProvider,
    username: &str,
    password: &str,
) -> Result<LdapUser, ApiError> {
    let provider = provider.clone();
    let username = username.to_string();
    let password = password.to_string();

    tokio::task::spawn_blocking(move || ldap_bind_sync(&provider, &username, &password))
        .await
        .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?
}

fn ldap_bind_sync(
    provider: &AuthProvider,
    username: &str,
    password: &str,
) -> Result<LdapUser, ApiError> {
    let url = provider
        .ldap_url
        .as_deref()
        .ok_or(DomainError::Validation("missing ldap_url".into()))?;
    let bind_dn = provider
        .ldap_bind_dn
        .as_deref()
        .ok_or(DomainError::Validation("missing ldap_bind_dn".into()))?;
    let bind_password = provider
        .ldap_bind_password
        .as_deref()
        .ok_or(DomainError::Validation("missing ldap_bind_password".into()))?;
    let base_dn = provider
        .ldap_base_dn
        .as_deref()
        .ok_or(DomainError::Validation("missing ldap_base_dn".into()))?;

    let mut ldap = LdapConn::new(url).map_err(|_| DomainError::Unauthorized)?;

    ldap.simple_bind(bind_dn, bind_password)
        .map_err(|_| DomainError::Unauthorized)?
        .success()
        .map_err(|_| DomainError::Unauthorized)?;

    let user_filter = provider.ldap_user_filter.replace("{username}", username);
    let (rs, _) = ldap
        .search(base_dn, Scope::Subtree, &user_filter, vec!["*"])
        .map_err(|_| DomainError::Unauthorized)?
        .success()
        .map_err(|_| DomainError::Unauthorized)?;

    let entry = rs.into_iter().next().ok_or(DomainError::Unauthorized)?;
    let search_entry = SearchEntry::construct(entry);
    let user_dn = search_entry.dn.clone();

    ldap.simple_bind(&user_dn, password)
        .map_err(|_| DomainError::Unauthorized)?
        .success()
        .map_err(|_| DomainError::Unauthorized)?;

    let email = search_entry
        .attrs
        .get(&provider.ldap_email_attr)
        .and_then(|v| v.first())
        .cloned()
        .unwrap_or_else(|| format!("{username}@ldap.local"));

    let display_name = search_entry
        .attrs
        .get(&provider.ldap_display_name_attr)
        .and_then(|v| v.first())
        .cloned();

    let group_filter = provider.ldap_group_filter.replace("{user_dn}", &user_dn);
    let (group_rs, _) = ldap
        .search(base_dn, Scope::Subtree, &group_filter, vec!["dn"])
        .map_err(|_| DomainError::Unauthorized)?
        .success()
        .map_err(|_| DomainError::Unauthorized)?;

    let groups = group_rs
        .into_iter()
        .map(|entry| SearchEntry::construct(entry).dn)
        .collect();

    let _ = ldap.unbind();

    Ok(LdapUser {
        dn: user_dn,
        email,
        display_name,
        groups,
    })
}
