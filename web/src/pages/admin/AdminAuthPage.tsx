import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Loader2, Plus, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { api } from '../../api/client'
import type { AuthProviderAdmin, AuthProviderType } from '../../api/types'
import { useAuth } from '../../auth/AuthContext'
import { Breadcrumbs, Checkbox, PageHeader, PrimaryButton, SecondaryButton, Select } from '../../components/ui'

const API_BASE = import.meta.env.VITE_API_BASE ?? '/api/v1'

const EMPTY_FORM = {
  name: '',
  provider_type: 'oidc' as AuthProviderType,
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
}

export function AdminAuthPage() {
  const { token } = useAuth()
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [showForm, setShowForm] = useState(false)

  const { data: providers = [], isLoading } = useQuery({
    queryKey: ['admin-auth-providers'],
    queryFn: () => api.listAdminAuthProviders(token!),
    enabled: Boolean(token),
    retry: false,
  })

  const createProvider = useMutation({
    mutationFn: () => api.createAuthProvider(token!, form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-auth-providers'] })
      setForm(EMPTY_FORM)
      setShowForm(false)
      setError(null)
    },
    onError: (err: Error) => setError(err.message),
  })

  const toggleProvider = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.updateAuthProvider(token!, id, { enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-auth-providers'] }),
    onError: (err: Error) => setError(err.message),
  })

  const deleteProvider = useMutation({
    mutationFn: (id: string) => api.deleteAuthProvider(token!, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-auth-providers'] }),
    onError: (err: Error) => setError(err.message),
  })

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    createProvider.mutate()
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
      />

      {error && (
        <div className="mb-4 p-3 rounded-md border border-red-r1/30 bg-dashboard-danger-bg text-dashboard-danger text-sm max-w-3xl">
          {error}
        </div>
      )}

      <div className="app-panel max-w-3xl mb-5">
        <div className="app-panel-header flex items-center justify-between">
          <span className="flex items-center gap-2">
            <KeyRound size={16} /> Providers
          </span>
          <SecondaryButton type="button" onClick={() => setShowForm((v) => !v)}>
            <Plus size={14} />
            Add provider
          </SecondaryButton>
        </div>

        {showForm && (
          <form className="app-panel-body space-y-3 border-b border-border" onSubmit={onSubmit}>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm">
                Name
                <input
                  className="app-field mt-1"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                />
              </label>
              <Select
                label="Type"
                value={form.provider_type}
                onChange={(e) =>
                  setForm({ ...form, provider_type: e.target.value as AuthProviderType })
                }
              >
                <option value="oidc">OIDC (Google, Azure AD, Okta)</option>
                <option value="saml">SAML 2.0</option>
                <option value="ldap">LDAP</option>
              </Select>
            </div>

            {form.provider_type === 'oidc' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm sm:col-span-2">
                  Issuer URL
                  <input
                    className="app-field mt-1"
                    placeholder="https://accounts.google.com"
                    value={form.issuer_url}
                    onChange={(e) => setForm({ ...form, issuer_url: e.target.value })}
                  />
                </label>
                <label className="text-sm">
                  Client ID
                  <input
                    className="app-field mt-1"
                    value={form.client_id}
                    onChange={(e) => setForm({ ...form, client_id: e.target.value })}
                  />
                </label>
                <label className="text-sm">
                  Client secret
                  <input
                    className="app-field mt-1"
                    type="password"
                    value={form.client_secret}
                    onChange={(e) => setForm({ ...form, client_secret: e.target.value })}
                  />
                </label>
              </div>
            )}

            {form.provider_type === 'saml' && (
              <div className="grid gap-3">
                <label className="text-sm">
                  IdP entity ID
                  <input
                    className="app-field mt-1"
                    value={form.idp_entity_id}
                    onChange={(e) => setForm({ ...form, idp_entity_id: e.target.value })}
                  />
                </label>
                <label className="text-sm">
                  IdP SSO URL
                  <input
                    className="app-field mt-1"
                    value={form.idp_sso_url}
                    onChange={(e) => setForm({ ...form, idp_sso_url: e.target.value })}
                  />
                </label>
                <label className="text-sm">
                  IdP certificate (PEM)
                  <textarea
                    className="app-field mt-1 min-h-24 font-mono text-xs"
                    value={form.idp_certificate}
                    onChange={(e) => setForm({ ...form, idp_certificate: e.target.value })}
                  />
                </label>
              </div>
            )}

            {form.provider_type === 'ldap' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm sm:col-span-2">
                  LDAP URL
                  <input
                    className="app-field mt-1"
                    placeholder="ldaps://ldap.example.com:636"
                    value={form.ldap_url}
                    onChange={(e) => setForm({ ...form, ldap_url: e.target.value })}
                  />
                </label>
                <label className="text-sm">
                  Bind DN
                  <input
                    className="app-field mt-1"
                    value={form.ldap_bind_dn}
                    onChange={(e) => setForm({ ...form, ldap_bind_dn: e.target.value })}
                  />
                </label>
                <label className="text-sm">
                  Bind password
                  <input
                    className="app-field mt-1"
                    type="password"
                    value={form.ldap_bind_password}
                    onChange={(e) => setForm({ ...form, ldap_bind_password: e.target.value })}
                  />
                </label>
                <label className="text-sm sm:col-span-2">
                  Base DN
                  <input
                    className="app-field mt-1"
                    value={form.ldap_base_dn}
                    onChange={(e) => setForm({ ...form, ldap_base_dn: e.target.value })}
                  />
                </label>
              </div>
            )}

            <PrimaryButton type="submit" disabled={createProvider.isPending}>
              {createProvider.isPending ? (
                <>
                  <Loader2 size={14} className="animate-spin" /> Saving…
                </>
              ) : (
                'Create provider'
              )}
            </PrimaryButton>
          </form>
        )}

        {isLoading && <div className="p-6 text-sm text-text-secondary">Loading…</div>}

        {!isLoading && providers.length === 0 && (
          <div className="p-6 text-sm text-text-secondary">No providers configured.</div>
        )}

        {providers.length > 0 && (
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
              {providers.map(({ provider }) => (
                <tr key={provider.id}>
                  <td className="font-medium">{provider.name}</td>
                  <td className="text-sm uppercase">{provider.provider_type}</td>
                  <td>
                    <Checkbox
                      row
                      label={provider.enabled ? 'Enabled' : 'Disabled'}
                      checked={provider.enabled}
                      onChange={(e) =>
                        toggleProvider.mutate({ id: provider.id, enabled: e.target.checked })
                      }
                    />
                  </td>
                  <td className="text-right space-x-2">
                    {loginUrl(provider) && (
                      <a
                        className="text-xs text-accent hover:underline"
                        href={loginUrl(provider)!}
                      >
                        Test login
                      </a>
                    )}
                    <SecondaryButton
                      type="button"
                      className="px-2 py-1"
                      onClick={() => {
                        if (window.confirm(`Delete provider "${provider.name}"?`)) {
                          deleteProvider.mutate(provider.id)
                        }
                      }}
                    >
                      <Trash2 size={14} />
                    </SecondaryButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-sm text-text-secondary max-w-3xl">
        OIDC redirect URI: <code className="text-text">{API_BASE}/auth/oidc/callback</code>.
        SAML ACS URL pattern: <code className="text-text">{API_BASE}/auth/saml/&lt;id&gt;/acs</code>.
        LDAP group → team mappings can be added via API after creating an LDAP provider.
      </p>
    </>
  )
}
