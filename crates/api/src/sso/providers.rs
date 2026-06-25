use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{delete, get, patch, post},
    Json, Router,
};
use chrono::Utc;
use pertisk_domain::{models::*, DomainError};
use serde::Serialize;
use uuid::Uuid;
use validator::Validate;

use super::{
    ensure_auth_admin, ensure_enabled_provider, issue_auth_response, jit_provision_user,
    load_provider, sync_ldap_group_memberships, ExternalUser,
};
use crate::{
    audit::{record_audit_event, AuditEventInput},
    ApiError, AppState, AuthUser,
};

pub fn sso_routes() -> Router<AppState> {
    Router::new()
        .route("/auth/providers", get(list_public_providers))
        .route("/auth/oidc/{provider_id}/login", get(oidc_login))
        .route("/auth/oidc/callback", get(super::oidc::oidc_callback))
        .route("/auth/saml/{provider_id}/login", get(super::saml::saml_login))
        .route("/auth/saml/{provider_id}/acs", post(super::saml::saml_acs))
        .route("/auth/ldap/{provider_id}/login", post(ldap_login))
        .route("/admin/auth-providers", get(list_auth_providers).post(create_auth_provider))
        .route(
            "/admin/auth-providers/{provider_id}",
            patch(update_auth_provider).delete(delete_auth_provider),
        )
        .route(
            "/admin/auth-providers/{provider_id}/ldap-mappings",
            get(list_ldap_mappings).post(create_ldap_mapping),
        )
        .route(
            "/admin/auth-providers/{provider_id}/ldap-mappings/{mapping_id}",
            delete(delete_ldap_mapping),
        )
}

#[derive(Serialize)]
struct AuthProviderAdminResponse {
    #[serde(flatten)]
    provider: AuthProviderSafe,
    ldap_mappings: Option<Vec<LdapGroupMappingWithOrg>>,
}

#[derive(Serialize)]
struct AuthProviderSafe {
    pub id: Uuid,
    pub name: String,
    pub provider_type: AuthProviderType,
    pub enabled: bool,
    pub issuer_url: Option<String>,
    pub client_id: Option<String>,
    pub has_client_secret: bool,
    pub scopes: String,
    pub idp_entity_id: Option<String>,
    pub idp_sso_url: Option<String>,
    pub has_idp_certificate: bool,
    pub sp_entity_id: Option<String>,
    pub ldap_url: Option<String>,
    pub ldap_bind_dn: Option<String>,
    pub has_ldap_bind_password: bool,
    pub ldap_base_dn: Option<String>,
    pub ldap_user_filter: String,
    pub ldap_email_attr: String,
    pub ldap_display_name_attr: String,
    pub ldap_username_attr: String,
    pub ldap_group_filter: String,
    pub created_at: chrono::DateTime<Utc>,
    pub updated_at: chrono::DateTime<Utc>,
}

#[derive(Serialize)]
struct LdapGroupMappingWithOrg {
    #[serde(flatten)]
    mapping: LdapGroupMapping,
    organization_slug: String,
    organization_name: String,
}

fn to_safe(provider: AuthProvider) -> AuthProviderSafe {
    AuthProviderSafe {
        id: provider.id,
        name: provider.name,
        provider_type: provider.provider_type,
        enabled: provider.enabled,
        issuer_url: provider.issuer_url,
        client_id: provider.client_id,
        has_client_secret: provider.client_secret.is_some(),
        scopes: provider.scopes,
        idp_entity_id: provider.idp_entity_id,
        idp_sso_url: provider.idp_sso_url,
        has_idp_certificate: provider.idp_certificate.is_some(),
        sp_entity_id: provider.sp_entity_id,
        ldap_url: provider.ldap_url,
        ldap_bind_dn: provider.ldap_bind_dn,
        has_ldap_bind_password: provider.ldap_bind_password.is_some(),
        ldap_base_dn: provider.ldap_base_dn,
        ldap_user_filter: provider.ldap_user_filter,
        ldap_email_attr: provider.ldap_email_attr,
        ldap_display_name_attr: provider.ldap_display_name_attr,
        ldap_username_attr: provider.ldap_username_attr,
        ldap_group_filter: provider.ldap_group_filter,
        created_at: provider.created_at,
        updated_at: provider.updated_at,
    }
}

async fn list_public_providers(
    State(state): State<AppState>,
) -> Result<Json<Vec<AuthProviderPublic>>, ApiError> {
    let rows = sqlx::query_as::<_, AuthProviderPublic>(
        r#"
        SELECT id, name, provider_type
        FROM auth_providers
        WHERE enabled = true
        ORDER BY name
        "#,
    )
    .fetch_all(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    Ok(Json(rows))
}

async fn list_auth_providers(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<Vec<AuthProviderAdminResponse>>, ApiError> {
    ensure_auth_admin(&state.pool, auth.user_id).await?;

    let providers = sqlx::query_as::<_, AuthProvider>(
        r#"
        SELECT
            id, name, provider_type, enabled,
            issuer_url, client_id, client_secret, scopes,
            idp_entity_id, idp_sso_url, idp_certificate, sp_entity_id,
            ldap_url, ldap_bind_dn, ldap_bind_password, ldap_base_dn,
            ldap_user_filter, ldap_email_attr, ldap_display_name_attr,
            ldap_username_attr, ldap_group_filter,
            created_at, updated_at
        FROM auth_providers
        ORDER BY name
        "#,
    )
    .fetch_all(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    let mut out = Vec::with_capacity(providers.len());
    for provider in providers {
        let ldap_mappings = if provider.provider_type == AuthProviderType::Ldap {
            Some(load_ldap_mappings(&state.pool, provider.id).await?)
        } else {
            None
        };
        out.push(AuthProviderAdminResponse {
            provider: to_safe(provider),
            ldap_mappings,
        });
    }

    Ok(Json(out))
}

async fn create_auth_provider(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(body): Json<CreateAuthProviderRequest>,
) -> Result<(StatusCode, Json<AuthProviderAdminResponse>), ApiError> {
    body.validate()
        .map_err(|e| ApiError::from(DomainError::Validation(e.to_string())))?;
    ensure_auth_admin(&state.pool, auth.user_id).await?;
    validate_provider_payload(&body.provider_type, &body)?;

    let provider = sqlx::query_as::<_, AuthProvider>(
        r#"
        INSERT INTO auth_providers (
            name, provider_type, enabled,
            issuer_url, client_id, client_secret, scopes,
            idp_entity_id, idp_sso_url, idp_certificate, sp_entity_id,
            ldap_url, ldap_bind_dn, ldap_bind_password, ldap_base_dn,
            ldap_user_filter, ldap_email_attr, ldap_display_name_attr,
            ldap_username_attr, ldap_group_filter
        )
        VALUES (
            $1, $2, COALESCE($3, false),
            $4, $5, $6, COALESCE($7, 'openid profile email'),
            $8, $9, $10, $11,
            $12, $13, $14, $15,
            COALESCE($16, '(uid={username})'),
            COALESCE($17, 'mail'),
            COALESCE($18, 'displayName'),
            COALESCE($19, 'uid'),
            COALESCE($20, '(member={user_dn})')
        )
        RETURNING
            id, name, provider_type, enabled,
            issuer_url, client_id, client_secret, scopes,
            idp_entity_id, idp_sso_url, idp_certificate, sp_entity_id,
            ldap_url, ldap_bind_dn, ldap_bind_password, ldap_base_dn,
            ldap_user_filter, ldap_email_attr, ldap_display_name_attr,
            ldap_username_attr, ldap_group_filter,
            created_at, updated_at
        "#,
    )
    .bind(&body.name)
    .bind(body.provider_type)
    .bind(body.enabled)
    .bind(&body.issuer_url)
    .bind(&body.client_id)
    .bind(&body.client_secret)
    .bind(&body.scopes)
    .bind(&body.idp_entity_id)
    .bind(&body.idp_sso_url)
    .bind(&body.idp_certificate)
    .bind(&body.sp_entity_id)
    .bind(&body.ldap_url)
    .bind(&body.ldap_bind_dn)
    .bind(&body.ldap_bind_password)
    .bind(&body.ldap_base_dn)
    .bind(body.ldap_user_filter.as_deref())
    .bind(body.ldap_email_attr.as_deref())
    .bind(body.ldap_display_name_attr.as_deref())
    .bind(body.ldap_username_attr.as_deref())
    .bind(body.ldap_group_filter.as_deref())
    .fetch_one(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    Ok((
        StatusCode::CREATED,
        Json(AuthProviderAdminResponse {
            provider: to_safe(provider),
            ldap_mappings: None,
        }),
    ))
}

async fn update_auth_provider(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(provider_id): Path<Uuid>,
    Json(body): Json<UpdateAuthProviderRequest>,
) -> Result<Json<AuthProviderAdminResponse>, ApiError> {
    body.validate()
        .map_err(|e| ApiError::from(DomainError::Validation(e.to_string())))?;
    ensure_auth_admin(&state.pool, auth.user_id).await?;

    let existing = load_provider(&state.pool, provider_id).await?;

    let provider = sqlx::query_as::<_, AuthProvider>(
        r#"
        UPDATE auth_providers SET
            name = COALESCE($2, name),
            enabled = COALESCE($3, enabled),
            issuer_url = COALESCE($4, issuer_url),
            client_id = COALESCE($5, client_id),
            client_secret = COALESCE($6, client_secret),
            scopes = COALESCE($7, scopes),
            idp_entity_id = COALESCE($8, idp_entity_id),
            idp_sso_url = COALESCE($9, idp_sso_url),
            idp_certificate = COALESCE($10, idp_certificate),
            sp_entity_id = COALESCE($11, sp_entity_id),
            ldap_url = COALESCE($12, ldap_url),
            ldap_bind_dn = COALESCE($13, ldap_bind_dn),
            ldap_bind_password = COALESCE($14, ldap_bind_password),
            ldap_base_dn = COALESCE($15, ldap_base_dn),
            ldap_user_filter = COALESCE($16, ldap_user_filter),
            ldap_email_attr = COALESCE($17, ldap_email_attr),
            ldap_display_name_attr = COALESCE($18, ldap_display_name_attr),
            ldap_username_attr = COALESCE($19, ldap_username_attr),
            ldap_group_filter = COALESCE($20, ldap_group_filter),
            updated_at = NOW()
        WHERE id = $1
        RETURNING
            id, name, provider_type, enabled,
            issuer_url, client_id, client_secret, scopes,
            idp_entity_id, idp_sso_url, idp_certificate, sp_entity_id,
            ldap_url, ldap_bind_dn, ldap_bind_password, ldap_base_dn,
            ldap_user_filter, ldap_email_attr, ldap_display_name_attr,
            ldap_username_attr, ldap_group_filter,
            created_at, updated_at
        "#,
    )
    .bind(provider_id)
    .bind(&body.name)
    .bind(body.enabled)
    .bind(&body.issuer_url)
    .bind(&body.client_id)
    .bind(&body.client_secret)
    .bind(&body.scopes)
    .bind(&body.idp_entity_id)
    .bind(&body.idp_sso_url)
    .bind(&body.idp_certificate)
    .bind(&body.sp_entity_id)
    .bind(&body.ldap_url)
    .bind(&body.ldap_bind_dn)
    .bind(&body.ldap_bind_password)
    .bind(&body.ldap_base_dn)
    .bind(body.ldap_user_filter.as_deref())
    .bind(body.ldap_email_attr.as_deref())
    .bind(body.ldap_display_name_attr.as_deref())
    .bind(body.ldap_username_attr.as_deref())
    .bind(body.ldap_group_filter.as_deref())
    .fetch_one(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    let ldap_mappings = if existing.provider_type == AuthProviderType::Ldap {
        Some(load_ldap_mappings(&state.pool, provider.id).await?)
    } else {
        None
    };

    Ok(Json(AuthProviderAdminResponse {
        provider: to_safe(provider),
        ldap_mappings,
    }))
}

async fn delete_auth_provider(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(provider_id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    ensure_auth_admin(&state.pool, auth.user_id).await?;

    sqlx::query("DELETE FROM auth_providers WHERE id = $1")
        .bind(provider_id)
        .execute(&state.pool)
        .await
        .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    Ok(StatusCode::NO_CONTENT)
}

async fn list_ldap_mappings(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(provider_id): Path<Uuid>,
) -> Result<Json<Vec<LdapGroupMappingWithOrg>>, ApiError> {
    ensure_auth_admin(&state.pool, auth.user_id).await?;
    let provider = load_provider(&state.pool, provider_id).await?;
    if provider.provider_type != AuthProviderType::Ldap {
        return Err(DomainError::Validation("provider is not LDAP".into()).into());
    }
    Ok(Json(load_ldap_mappings(&state.pool, provider_id).await?))
}

async fn create_ldap_mapping(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(provider_id): Path<Uuid>,
    Json(body): Json<CreateLdapGroupMappingRequest>,
) -> Result<(StatusCode, Json<LdapGroupMappingWithOrg>), ApiError> {
    body.validate()
        .map_err(|e| ApiError::from(DomainError::Validation(e.to_string())))?;
    ensure_auth_admin(&state.pool, auth.user_id).await?;
    let provider = load_provider(&state.pool, provider_id).await?;
    if provider.provider_type != AuthProviderType::Ldap {
        return Err(DomainError::Validation("provider is not LDAP".into()).into());
    }

    let role = body.org_role.unwrap_or(OrgRole::Member);
    let mapping = sqlx::query_as::<_, LdapGroupMapping>(
        r#"
        INSERT INTO ldap_group_mappings (provider_id, ldap_group_dn, organization_id, org_role)
        VALUES ($1, $2, $3, $4)
        RETURNING id, provider_id, ldap_group_dn, organization_id, org_role, created_at
        "#,
    )
    .bind(provider_id)
    .bind(&body.ldap_group_dn)
    .bind(body.organization_id)
    .bind(role)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| match e {
        sqlx::Error::Database(db) if db.constraint().is_some() => {
            ApiError::from(DomainError::Conflict("mapping already exists".into()))
        }
        other => ApiError::from(DomainError::Internal(other.to_string())),
    })?;

    let org = sqlx::query_as::<_, (String, String)>(
        "SELECT slug, name FROM organizations WHERE id = $1",
    )
    .bind(body.organization_id)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    Ok((
        StatusCode::CREATED,
        Json(LdapGroupMappingWithOrg {
            mapping,
            organization_slug: org.0,
            organization_name: org.1,
        }),
    ))
}

async fn delete_ldap_mapping(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((provider_id, mapping_id)): Path<(Uuid, Uuid)>,
) -> Result<StatusCode, ApiError> {
    ensure_auth_admin(&state.pool, auth.user_id).await?;
    let _provider = load_provider(&state.pool, provider_id).await?;

    sqlx::query("DELETE FROM ldap_group_mappings WHERE id = $1 AND provider_id = $2")
        .bind(mapping_id)
        .bind(provider_id)
        .execute(&state.pool)
        .await
        .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    Ok(StatusCode::NO_CONTENT)
}

async fn load_ldap_mappings(
    pool: &sqlx::PgPool,
    provider_id: Uuid,
) -> Result<Vec<LdapGroupMappingWithOrg>, ApiError> {
    let rows = sqlx::query_as::<_, (Uuid, Uuid, String, Uuid, OrgRole, chrono::DateTime<Utc>, String, String)>(
        r#"
        SELECT
            m.id, m.provider_id, m.ldap_group_dn, m.organization_id, m.org_role, m.created_at,
            o.slug, o.name
        FROM ldap_group_mappings m
        INNER JOIN organizations o ON o.id = m.organization_id
        WHERE m.provider_id = $1
        ORDER BY o.slug, m.ldap_group_dn
        "#,
    )
    .bind(provider_id)
    .fetch_all(pool)
    .await
    .map_err(|e| ApiError::from(DomainError::Internal(e.to_string())))?;

    Ok(rows
        .into_iter()
        .map(
            |(id, provider_id, ldap_group_dn, organization_id, org_role, created_at, organization_slug, organization_name)| {
                LdapGroupMappingWithOrg {
                    mapping: LdapGroupMapping {
                        id,
                        provider_id,
                        ldap_group_dn,
                        organization_id,
                        org_role,
                        created_at,
                    },
                    organization_slug,
                    organization_name,
                }
            },
        )
        .collect())
}

fn validate_provider_payload(
    provider_type: &AuthProviderType,
    body: &CreateAuthProviderRequest,
) -> Result<(), ApiError> {
    match provider_type {
        AuthProviderType::Oidc => {
            if body.issuer_url.as_deref().unwrap_or("").is_empty()
                || body.client_id.as_deref().unwrap_or("").is_empty()
            {
                return Err(DomainError::Validation(
                    "OIDC requires issuer_url and client_id".into(),
                )
                .into());
            }
        }
        AuthProviderType::Saml => {
            if body.idp_entity_id.as_deref().unwrap_or("").is_empty()
                || body.idp_sso_url.as_deref().unwrap_or("").is_empty()
                || body.idp_certificate.as_deref().unwrap_or("").is_empty()
            {
                return Err(DomainError::Validation(
                    "SAML requires idp_entity_id, idp_sso_url, and idp_certificate".into(),
                )
                .into());
            }
        }
        AuthProviderType::Ldap => {
            if body.ldap_url.as_deref().unwrap_or("").is_empty()
                || body.ldap_bind_dn.as_deref().unwrap_or("").is_empty()
                || body.ldap_bind_password.as_deref().unwrap_or("").is_empty()
                || body.ldap_base_dn.as_deref().unwrap_or("").is_empty()
            {
                return Err(DomainError::Validation(
                    "LDAP requires ldap_url, bind credentials, and base_dn".into(),
                )
                .into());
            }
        }
    }
    Ok(())
}

async fn oidc_login(
    State(state): State<AppState>,
    Path(provider_id): Path<Uuid>,
) -> Result<axum::response::Redirect, ApiError> {
    super::oidc::start_oidc_login(&state, provider_id).await
}

async fn ldap_login(
    State(state): State<AppState>,
    Path(provider_id): Path<Uuid>,
    Json(body): Json<LdapLoginRequest>,
) -> Result<Json<AuthResponse>, ApiError> {
    body.validate()
        .map_err(|e| ApiError::from(DomainError::Validation(e.to_string())))?;

    let provider = load_provider(&state.pool, provider_id).await?;
    ensure_enabled_provider(&provider)?;
    if provider.provider_type != AuthProviderType::Ldap {
        return Err(DomainError::Validation("provider is not LDAP".into()).into());
    }

    let ldap_user = super::ldap::authenticate_ldap(&provider, &body.username, &body.password)
        .await
        .map_err(|_| ApiError::from(DomainError::Unauthorized))?;

    let external = ExternalUser {
        subject: ldap_user.dn.clone(),
        email: ldap_user.email,
        display_name: ldap_user.display_name,
        username_hint: Some(body.username.clone()),
    };

    let user = jit_provision_user(&state.pool, &provider, &external).await?;
    sync_ldap_group_memberships(&state.pool, provider.id, user.id, &ldap_user.groups).await?;

    record_audit_event(
        &state.pool,
        AuditEventInput {
            organization_id: None,
            actor_user_id: Some(user.id),
            event_type: AuditEventType::SsoLogin,
            action: format!("ldap login via {}", provider.name),
            resource_type: Some("auth_provider".into()),
            resource_id: Some(provider.id.to_string()),
            metadata: Some(serde_json::json!({ "provider_type": "ldap" })),
            ip_address: None,
            user_agent: None,
        },
    )
    .await?;

    Ok(Json(issue_auth_response(&state, user).await?))
}
