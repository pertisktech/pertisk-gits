-- Phase 6: SSO/LDAP providers, external identities, audit logs

CREATE TYPE auth_provider_type AS ENUM ('oidc', 'saml', 'ldap');

CREATE TYPE audit_event_type AS ENUM (
    'login',
    'sso_login',
    'repo_access',
    'permission_change',
    'merge'
);

-- Instance-level auth providers (OIDC, SAML, LDAP)
CREATE TABLE auth_providers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    provider_type auth_provider_type NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT false,
    -- OIDC
    issuer_url TEXT,
    client_id TEXT,
    client_secret TEXT,
    scopes TEXT NOT NULL DEFAULT 'openid profile email',
    -- SAML IdP
    idp_entity_id TEXT,
    idp_sso_url TEXT,
    idp_certificate TEXT,
    sp_entity_id TEXT,
    -- LDAP
    ldap_url TEXT,
    ldap_bind_dn TEXT,
    ldap_bind_password TEXT,
    ldap_base_dn TEXT,
    ldap_user_filter TEXT NOT NULL DEFAULT '(uid={username})',
    ldap_email_attr TEXT NOT NULL DEFAULT 'mail',
    ldap_display_name_attr TEXT NOT NULL DEFAULT 'displayName',
    ldap_username_attr TEXT NOT NULL DEFAULT 'uid',
    ldap_group_filter TEXT NOT NULL DEFAULT '(member={user_dn})',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_auth_providers_enabled ON auth_providers(enabled) WHERE enabled = true;

-- LDAP group DN → organization membership
CREATE TABLE ldap_group_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id UUID NOT NULL REFERENCES auth_providers(id) ON DELETE CASCADE,
    ldap_group_dn TEXT NOT NULL,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    org_role org_role NOT NULL DEFAULT 'member',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (provider_id, ldap_group_dn)
);

CREATE INDEX idx_ldap_group_mappings_provider ON ldap_group_mappings(provider_id);

-- Links local users to external IdP subjects (OIDC sub, SAML NameID, LDAP DN)
CREATE TABLE user_external_identities (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider_id UUID NOT NULL REFERENCES auth_providers(id) ON DELETE CASCADE,
    external_subject TEXT NOT NULL,
    external_email TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (provider_id, external_subject)
);

CREATE INDEX idx_user_external_identities_user ON user_external_identities(user_id);

-- Short-lived OAuth/SAML state (PKCE verifier, relay state)
CREATE TABLE auth_flow_states (
    state TEXT PRIMARY KEY,
    provider_id UUID NOT NULL REFERENCES auth_providers(id) ON DELETE CASCADE,
    code_verifier TEXT,
    nonce TEXT,
    redirect_after TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_auth_flow_states_expires ON auth_flow_states(expires_at);

-- SSO-only users may have no local password
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

-- Append-only audit trail
CREATE TABLE audit_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
    actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    event_type audit_event_type NOT NULL,
    action TEXT NOT NULL,
    resource_type TEXT,
    resource_id TEXT,
    metadata JSONB NOT NULL DEFAULT '{}',
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_events_org_created ON audit_events(organization_id, created_at DESC);
CREATE INDEX idx_audit_events_type ON audit_events(event_type);
CREATE INDEX idx_audit_events_actor ON audit_events(actor_user_id);
CREATE INDEX idx_audit_events_created ON audit_events(created_at DESC);
