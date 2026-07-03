import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Loader2, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState, type Dispatch, type FormEvent, type SetStateAction } from 'react'
import { api } from '../../api/client'
import type { AuthProviderAdmin, AuthProviderType } from '../../api/types'
import { useAuth } from '../../auth/AuthContext'
import { StatusBadge } from '../../components/StatusBadge'
import {
  Breadcrumbs,
  Checkbox,
  PageHeader,
  PrimaryButton,
  SecondaryButton,
  Select,
} from '../../components/ui'

const API_BASE = import.meta.env.VITE_API_BASE ?? '/api/v1'

const fieldClass =
  'w-full px-3 py-2 rounded-lg border border-naturals-n4 bg-surface text-text text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary'

type ProviderForm = {
  name: string
  provider_type: AuthProviderType
  enabled: boolean
  issuer_url: string
  client_id: string
  client_secret: string
  scopes: string
  idp_entity_id: string
  idp_sso_url: string
  idp_certificate: string
  sp_entity_id: string
  ldap_url: string
  ldap_bind_dn: string
  ldap_bind_password: string
  ldap_base_dn: string
  ldap_user_filter: string
  ldap_email_attr: string
  ldap_display_name_attr: string
  ldap_username_attr: string
  ldap_group_filter: string
}

const EMPTY_FORM: ProviderForm = {
  name: '',
  provider_type: 'oidc',
  enabled: true,
  issuer_url: '',
  client_id: '',
  client_secret: '',
  scopes: 'openid profile email',
  idp_entity_id: '',
  idp_sso_url: '',
  idp_certificate: '',
  sp_entity_id: '',
  ldap_url: '',
  ldap_bind_dn: '',
  ldap_bind_password: '',
  ldap_base_dn: '',
  ldap_user_filter: '(uid={username})',
  ldap_email_attr: 'mail',
  ldap_display_name_attr: 'displayName',
  ldap_username_attr: 'uid',
  ldap_group_filter: '(member={user_dn})',
}

function providerToForm(provider: AuthProviderAdmin): ProviderForm {
  return {
    name: provider.name,
    provider_type: provider.provider_type,
    enabled: provider.enabled,
    issuer_url: provider.issuer_url ?? '',
    client_id: provider.client_id ?? '',
    client_secret: '',
    scopes: provider.scopes,
    idp_entity_id: provider.idp_entity_id ?? '',
    idp_sso_url: provider.idp_sso_url ?? '',
    idp_certificate: '',
    sp_entity_id: provider.sp_entity_id ?? '',
    ldap_url: provider.ldap_url ?? '',
    ldap_bind_dn: provider.ldap_bind_dn ?? '',
    ldap_bind_password: '',
    ldap_base_dn: provider.ldap_base_dn ?? '',
    ldap_user_filter: provider.ldap_user_filter,
    ldap_email_attr: provider.ldap_email_attr,
    ldap_display_name_attr: provider.ldap_display_name_attr,
    ldap_username_attr: provider.ldap_username_attr,
    ldap_group_filter: provider.ldap_group_filter,
  }
}

function buildCreatePayload(form: ProviderForm): Record<string, unknown> {
  return {
    name: form.name,
    provider_type: form.provider_type,
    enabled: form.enabled,
    issuer_url: form.issuer_url || undefined,
    client_id: form.client_id || undefined,
    client_secret: form.client_secret || undefined,
    scopes: form.scopes || undefined,
    idp_entity_id: form.idp_entity_id || undefined,
    idp_sso_url: form.idp_sso_url || undefined,
    idp_certificate: form.idp_certificate || undefined,
    sp_entity_id: form.sp_entity_id || undefined,
    ldap_url: form.ldap_url || undefined,
    ldap_bind_dn: form.ldap_bind_dn || undefined,
    ldap_bind_password: form.ldap_bind_password || undefined,
    ldap_base_dn: form.ldap_base_dn || undefined,
    ldap_user_filter: form.ldap_user_filter || undefined,
    ldap_email_attr: form.ldap_email_attr || undefined,
    ldap_display_name_attr: form.ldap_display_name_attr || undefined,
    ldap_username_attr: form.ldap_username_attr || undefined,
    ldap_group_filter: form.ldap_group_filter || undefined,
  }
}

function buildUpdatePayload(form: ProviderForm): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    name: form.name,
    enabled: form.enabled,
    issuer_url: form.issuer_url || undefined,
    client_id: form.client_id || undefined,
    scopes: form.scopes || undefined,
    idp_entity_id: form.idp_entity_id || undefined,
    idp_sso_url: form.idp_sso_url || undefined,
    sp_entity_id: form.sp_entity_id || undefined,
    ldap_url: form.ldap_url || undefined,
    ldap_bind_dn: form.ldap_bind_dn || undefined,
    ldap_base_dn: form.ldap_base_dn || undefined,
    ldap_user_filter: form.ldap_user_filter || undefined,
    ldap_email_attr: form.ldap_email_attr || undefined,
    ldap_display_name_attr: form.ldap_display_name_attr || undefined,
    ldap_username_attr: form.ldap_username_attr || undefined,
    ldap_group_filter: form.ldap_group_filter || undefined,
  }
  if (form.client_secret) payload.client_secret = form.client_secret
  if (form.idp_certificate) payload.idp_certificate = form.idp_certificate
  if (form.ldap_bind_password) payload.ldap_bind_password = form.ldap_bind_password
  return payload
}

function providerTypeLabel(type: AuthProviderType) {
  if (type === 'oidc') return 'OIDC'
  if (type === 'saml') return 'SAML'
  return 'LDAP'
}

function ProviderFormFields({
  form,
  setForm,
  editing,
  editingProvider,
}: {
  form: ProviderForm
  setForm: Dispatch<SetStateAction<ProviderForm>>
  editing: boolean
  editingProvider?: AuthProviderAdmin | null
}) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-semibold text-text">
          Name
          <input
            className={`${fieldClass} mt-1.5`}
            value={form.name}
            onChange={(e) => setForm((current) => ({ ...current, name: e.target.value }))}
            required
          />
        </label>
        {editing ? (
          <div className="block text-sm font-semibold text-text">
            Type
            <div className={`${fieldClass} mt-1.5 text-text-secondary`}>
              {providerTypeLabel(form.provider_type)}
            </div>
          </div>
        ) : (
          <Select
            label="Type"
            value={form.provider_type}
            onChange={(e) =>
              setForm((current) => ({
                ...current,
                provider_type: e.target.value as AuthProviderType,
              }))
            }
          >
            <option value="oidc">OIDC (Auth0, Google, Azure AD, Okta)</option>
            <option value="saml">SAML 2.0</option>
            <option value="ldap">LDAP</option>
          </Select>
        )}
      </div>

      <Checkbox
        row
        label="Enabled on login page"
        checked={form.enabled}
        onChange={(e) => setForm((current) => ({ ...current, enabled: e.target.checked }))}
      />

      {form.provider_type === 'oidc' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-semibold text-text sm:col-span-2">
            Issuer URL
            <input
              className={`${fieldClass} mt-1.5 font-mono text-xs`}
              placeholder="https://your-tenant.auth0.com"
              value={form.issuer_url}
              onChange={(e) => setForm((current) => ({ ...current, issuer_url: e.target.value }))}
            />
          </label>
          <label className="block text-sm font-semibold text-text">
            Client ID
            <input
              className={`${fieldClass} mt-1.5 font-mono text-xs`}
              value={form.client_id}
              onChange={(e) => setForm((current) => ({ ...current, client_id: e.target.value }))}
            />
          </label>
          <label className="block text-sm font-semibold text-text">
            {editing ? 'Client secret (optional)' : 'Client secret'}
            <input
              className={`${fieldClass} mt-1.5`}
              type="password"
              placeholder={
                editing && editingProvider?.has_client_secret
                  ? 'Leave blank to keep current secret'
                  : undefined
              }
              value={form.client_secret}
              onChange={(e) => setForm((current) => ({ ...current, client_secret: e.target.value }))}
            />
          </label>
          <label className="block text-sm font-semibold text-text sm:col-span-2">
            Scopes
            <input
              className={`${fieldClass} mt-1.5 font-mono text-xs`}
              value={form.scopes}
              onChange={(e) => setForm((current) => ({ ...current, scopes: e.target.value }))}
            />
          </label>
        </div>
      )}

      {form.provider_type === 'saml' && (
        <div className="grid gap-4">
          <label className="block text-sm font-semibold text-text">
            IdP entity ID
            <input
              className={`${fieldClass} mt-1.5`}
              value={form.idp_entity_id}
              onChange={(e) => setForm((current) => ({ ...current, idp_entity_id: e.target.value }))}
            />
          </label>
          <label className="block text-sm font-semibold text-text">
            IdP SSO URL
            <input
              className={`${fieldClass} mt-1.5 font-mono text-xs`}
              value={form.idp_sso_url}
              onChange={(e) => setForm((current) => ({ ...current, idp_sso_url: e.target.value }))}
            />
          </label>
          <label className="block text-sm font-semibold text-text">
            SP entity ID (optional)
            <input
              className={`${fieldClass} mt-1.5`}
              value={form.sp_entity_id}
              onChange={(e) => setForm((current) => ({ ...current, sp_entity_id: e.target.value }))}
            />
          </label>
          <label className="block text-sm font-semibold text-text">
            {editing ? 'IdP certificate PEM (optional)' : 'IdP certificate (PEM)'}
            <textarea
              className={`${fieldClass} mt-1.5 min-h-28 font-mono text-xs`}
              placeholder={
                editing && editingProvider?.has_idp_certificate
                  ? 'Leave blank to keep current certificate'
                  : undefined
              }
              value={form.idp_certificate}
              onChange={(e) =>
                setForm((current) => ({ ...current, idp_certificate: e.target.value }))
              }
            />
          </label>
        </div>
      )}

      {form.provider_type === 'ldap' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-semibold text-text sm:col-span-2">
            LDAP URL
            <input
              className={`${fieldClass} mt-1.5 font-mono text-xs`}
              placeholder="ldaps://ldap.example.com:636"
              value={form.ldap_url}
              onChange={(e) => setForm((current) => ({ ...current, ldap_url: e.target.value }))}
            />
          </label>
          <label className="block text-sm font-semibold text-text">
            Bind DN
            <input
              className={`${fieldClass} mt-1.5 font-mono text-xs`}
              value={form.ldap_bind_dn}
              onChange={(e) => setForm((current) => ({ ...current, ldap_bind_dn: e.target.value }))}
            />
          </label>
          <label className="block text-sm font-semibold text-text">
            {editing ? 'Bind password (optional)' : 'Bind password'}
            <input
              className={`${fieldClass} mt-1.5`}
              type="password"
              placeholder={
                editing && editingProvider?.has_ldap_bind_password
                  ? 'Leave blank to keep current password'
                  : undefined
              }
              value={form.ldap_bind_password}
              onChange={(e) =>
                setForm((current) => ({ ...current, ldap_bind_password: e.target.value }))
              }
            />
          </label>
          <label className="block text-sm font-semibold text-text sm:col-span-2">
            Base DN
            <input
              className={`${fieldClass} mt-1.5 font-mono text-xs`}
              value={form.ldap_base_dn}
              onChange={(e) => setForm((current) => ({ ...current, ldap_base_dn: e.target.value }))}
            />
          </label>
          <label className="block text-sm font-semibold text-text sm:col-span-2">
            User filter
            <input
              className={`${fieldClass} mt-1.5 font-mono text-xs`}
              value={form.ldap_user_filter}
              onChange={(e) =>
                setForm((current) => ({ ...current, ldap_user_filter: e.target.value }))
              }
            />
          </label>
          <label className="block text-sm font-semibold text-text">
            Email attribute
            <input
              className={`${fieldClass} mt-1.5`}
              value={form.ldap_email_attr}
              onChange={(e) =>
                setForm((current) => ({ ...current, ldap_email_attr: e.target.value }))
              }
            />
          </label>
          <label className="block text-sm font-semibold text-text">
            Username attribute
            <input
              className={`${fieldClass} mt-1.5`}
              value={form.ldap_username_attr}
              onChange={(e) =>
                setForm((current) => ({ ...current, ldap_username_attr: e.target.value }))
              }
            />
          </label>
        </div>
      )}
    </>
  )
}

export function AdminAuthPage() {
  const { token } = useAuth()
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<ProviderForm>(EMPTY_FORM)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<AuthProviderAdmin | null>(null)

  const { data: providers = [], isLoading } = useQuery({
    queryKey: ['admin-auth-providers'],
    queryFn: () => api.listAdminAuthProviders(token!),
    enabled: Boolean(token),
    retry: false,
  })

  const createProvider = useMutation({
    mutationFn: () => api.createAuthProvider(token!, buildCreatePayload(form)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-auth-providers'] })
      closeForm()
    },
    onError: (err: Error) => setError(err.message),
  })

  const updateProvider = useMutation({
    mutationFn: () => api.updateAuthProvider(token!, editing!.id, buildUpdatePayload(form)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-auth-providers'] })
      closeForm()
    },
    onError: (err: Error) => setError(err.message),
  })

  const deleteProvider = useMutation({
    mutationFn: (id: string) => api.deleteAuthProvider(token!, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-auth-providers'] })
      setError(null)
    },
    onError: (err: Error) => setError(err.message),
  })

  function openCreate() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setShowForm(true)
    setError(null)
  }

  function openEdit(provider: AuthProviderAdmin) {
    setShowForm(false)
    setEditing(provider)
    setForm(providerToForm(provider))
    setError(null)
  }

  function closeForm() {
    setShowForm(false)
    setEditing(null)
    setForm(EMPTY_FORM)
    setError(null)
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (editing) updateProvider.mutate()
    else createProvider.mutate()
  }

  function loginUrl(provider: AuthProviderAdmin) {
    if (provider.provider_type === 'oidc') {
      return `${API_BASE}/auth/oidc/${provider.id}/login`
    }
    if (provider.provider_type === 'saml') {
      return `${API_BASE}/auth/saml/${provider.id}/login`
    }
    return null
  }

  const formOpen = showForm || editing
  const saving = createProvider.isPending || updateProvider.isPending

  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Admin', to: '/admin' },
          { label: 'SSO / LDAP' },
        ]}
      />
      <PageHeader
        title="SSO / LDAP"
        subtitle="Configure instance authentication providers (OIDC, SAML, LDAP)."
        action={
          <PrimaryButton type="button" onClick={openCreate}>
            <Plus size={14} />
            Add provider
          </PrimaryButton>
        }
      />

      {error && (
        <div className="mb-4 p-3 rounded-lg border border-red-r1/30 bg-dashboard-danger-bg text-dashboard-danger text-sm max-w-3xl">
          {error}
        </div>
      )}

      {formOpen && (
        <div className="app-panel mb-4 max-w-3xl">
          <div className="app-panel-header flex items-center gap-2">
            <KeyRound size={16} />
            {editing ? `Edit ${editing.name}` : 'New provider'}
          </div>
          <form onSubmit={onSubmit} className="app-panel-body space-y-4">
            <ProviderFormFields
              form={form}
              setForm={setForm}
              editing={Boolean(editing)}
              editingProvider={editing}
            />
            <div className="flex flex-wrap gap-2 pt-1">
              <PrimaryButton type="submit" disabled={saving}>
                {saving ? (
                  <>
                    <Loader2 size={14} className="animate-spin" /> Saving…
                  </>
                ) : editing ? (
                  'Save changes'
                ) : (
                  'Create provider'
                )}
              </PrimaryButton>
              <SecondaryButton type="button" onClick={closeForm}>
                Cancel
              </SecondaryButton>
            </div>
          </form>
        </div>
      )}

      <div className="app-panel max-w-4xl">
        <div className="app-panel-header flex items-center justify-between">
          <span>Providers</span>
          <span className="font-normal text-text-secondary">{providers.length}</span>
        </div>

        {isLoading && (
          <div className="p-8 text-center text-text-secondary text-sm flex items-center justify-center gap-2">
            <Loader2 size={16} className="animate-spin" />
            Loading providers…
          </div>
        )}

        {!isLoading && providers.length === 0 && (
          <div className="p-8 text-center text-text-secondary text-sm">
            No providers configured. Add one to enable SSO or LDAP login.
          </div>
        )}

        {!isLoading && providers.length > 0 && (
          <table className="app-list-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {providers.map((provider) => (
                <tr key={provider.id} className={editing?.id === provider.id ? 'bg-hover/40' : undefined}>
                  <td>
                    <div className="font-medium text-text">{provider.name}</div>
                    {provider.provider_type === 'oidc' && provider.issuer_url && (
                      <div className="text-xs text-text-secondary font-mono mt-0.5 truncate max-w-xs">
                        {provider.issuer_url}
                      </div>
                    )}
                  </td>
                  <td>
                    <StatusBadge variant="gray">{providerTypeLabel(provider.provider_type)}</StatusBadge>
                  </td>
                  <td>
                    <StatusBadge variant={provider.enabled ? 'green' : 'gray'}>
                      {provider.enabled ? 'Enabled' : 'Disabled'}
                    </StatusBadge>
                  </td>
                  <td className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {loginUrl(provider) && (
                        <a
                          className="text-xs text-accent hover:underline px-2 py-1"
                          href={loginUrl(provider)!}
                        >
                          Test
                        </a>
                      )}
                      <SecondaryButton
                        type="button"
                        className="px-2 py-1"
                        title="Edit provider"
                        onClick={() => openEdit(provider)}
                      >
                        <Pencil size={14} />
                      </SecondaryButton>
                      <SecondaryButton
                        type="button"
                        className="px-2 py-1"
                        title="Delete provider"
                        onClick={() => {
                          if (window.confirm(`Delete provider "${provider.name}"?`)) {
                            if (editing?.id === provider.id) closeForm()
                            deleteProvider.mutate(provider.id)
                          }
                        }}
                      >
                        <Trash2 size={14} />
                      </SecondaryButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-sm text-text-secondary max-w-3xl mt-4">
        OIDC redirect URI: <code className="text-text">{API_BASE}/auth/oidc/callback</code>.
        SAML ACS URL: <code className="text-text">{API_BASE}/auth/saml/&lt;id&gt;/acs</code>.
        LDAP group mappings can be added via API after creating an LDAP provider.
      </p>
    </>
  )
}
