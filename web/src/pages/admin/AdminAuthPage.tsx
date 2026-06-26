import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Loader2, Plus, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { api } from '../../api/client'
import type { AuthProviderAdmin, AuthProviderType } from '../../api/types'
import { useAuth } from '../../auth/AuthContext'
import { StatusBadge } from '../../components/StatusBadge'
import { Card } from '../../components/Card'
import {
  Alert,
  Breadcrumbs,
  PageHeader,
  PrimaryButton,
  SecondaryButton,
} from '../../components/ui'
import { CheckboxField, FieldLabel, Input, Select, Textarea } from '../../components/ui/Input'

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
    <div className="space-y-6">
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
          <SecondaryButton type="button" onClick={() => setShowForm((v) => !v)} startIcon={<Plus size={16} />}>
            Add provider
          </SecondaryButton>
        }
      />

      {error && <Alert>{error}</Alert>}

      {showForm && (
        <Card title="New provider" className="max-w-3xl">
          <form className="space-y-4" onSubmit={onSubmit}>
            <div className="grid gap-4 sm:grid-cols-2">
              <FieldLabel label="Name">
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                />
              </FieldLabel>
              <FieldLabel label="Type">
                <Select
                  value={form.provider_type}
                  onChange={(e) =>
                    setForm({ ...form, provider_type: e.target.value as AuthProviderType })
                  }
                >
                  <option value="oidc">OIDC (Google, Azure AD, Okta)</option>
                  <option value="saml">SAML 2.0</option>
                  <option value="ldap">LDAP</option>
                </Select>
              </FieldLabel>
            </div>

            {form.provider_type === 'oidc' && (
              <div className="grid gap-4 sm:grid-cols-2">
                <FieldLabel label="Issuer URL" hint="e.g. https://accounts.google.com">
                  <Input
                    value={form.issuer_url}
                    onChange={(e) => setForm({ ...form, issuer_url: e.target.value })}
                  />
                </FieldLabel>
                <FieldLabel label="Client ID">
                  <Input
                    value={form.client_id}
                    onChange={(e) => setForm({ ...form, client_id: e.target.value })}
                  />
                </FieldLabel>
                <FieldLabel label="Client secret">
                  <Input
                    type="password"
                    value={form.client_secret}
                    onChange={(e) => setForm({ ...form, client_secret: e.target.value })}
                  />
                </FieldLabel>
              </div>
            )}

            {form.provider_type === 'saml' && (
              <div className="space-y-4">
                <FieldLabel label="IdP entity ID">
                  <Input
                    value={form.idp_entity_id}
                    onChange={(e) => setForm({ ...form, idp_entity_id: e.target.value })}
                  />
                </FieldLabel>
                <FieldLabel label="IdP SSO URL">
                  <Input
                    value={form.idp_sso_url}
                    onChange={(e) => setForm({ ...form, idp_sso_url: e.target.value })}
                  />
                </FieldLabel>
                <FieldLabel label="IdP certificate (PEM)">
                  <Textarea
                    className="min-h-24 font-mono text-theme-xs"
                    value={form.idp_certificate}
                    onChange={(e) => setForm({ ...form, idp_certificate: e.target.value })}
                  />
                </FieldLabel>
              </div>
            )}

            {form.provider_type === 'ldap' && (
              <div className="grid gap-4 sm:grid-cols-2">
                <FieldLabel label="LDAP URL" hint="ldaps://ldap.example.com:636">
                  <Input
                    value={form.ldap_url}
                    onChange={(e) => setForm({ ...form, ldap_url: e.target.value })}
                  />
                </FieldLabel>
                <FieldLabel label="Bind DN">
                  <Input
                    value={form.ldap_bind_dn}
                    onChange={(e) => setForm({ ...form, ldap_bind_dn: e.target.value })}
                  />
                </FieldLabel>
                <FieldLabel label="Bind password">
                  <Input
                    type="password"
                    value={form.ldap_bind_password}
                    onChange={(e) => setForm({ ...form, ldap_bind_password: e.target.value })}
                  />
                </FieldLabel>
                <FieldLabel label="Base DN">
                  <Input
                    value={form.ldap_base_dn}
                    onChange={(e) => setForm({ ...form, ldap_base_dn: e.target.value })}
                  />
                </FieldLabel>
              </div>
            )}

            <div className="flex gap-2">
              <PrimaryButton type="submit" disabled={createProvider.isPending}>
                {createProvider.isPending ? 'Saving…' : 'Create provider'}
              </PrimaryButton>
              <SecondaryButton type="button" onClick={() => setShowForm(false)}>
                Cancel
              </SecondaryButton>
            </div>
          </form>
        </Card>
      )}

      <div className="shell-card max-w-3xl">
        <div className="shell-card-header">
          <span className="flex items-center gap-2">
            <KeyRound size={16} />
            Providers
          </span>
          <span className="font-normal text-gray-500 dark:text-gray-400">{providers.length}</span>
        </div>

        {isLoading && (
          <div className="shell-card-body flex items-center justify-center gap-2 py-12 text-theme-sm text-gray-500 dark:text-gray-400">
            <Loader2 size={16} className="animate-spin" />
            Loading providers…
          </div>
        )}

        {!isLoading && providers.length === 0 && (
          <div className="shell-card-body py-12 text-center text-theme-sm text-gray-500 dark:text-gray-400">
            No providers configured.
          </div>
        )}

        {!isLoading && providers.length > 0 && (
          <div className="overflow-x-auto">
            <table className="shell-table w-full">
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
                    <td className="font-medium text-gray-800 dark:text-white/90">{provider.name}</td>
                    <td>
                      <StatusBadge variant="gray">{provider.provider_type.toUpperCase()}</StatusBadge>
                    </td>
                    <td>
                      <CheckboxField
                        label={provider.enabled ? 'Enabled' : 'Disabled'}
                        checked={provider.enabled}
                        onChange={(enabled) => toggleProvider.mutate({ id: provider.id, enabled })}
                      />
                    </td>
                    <td>
                      <div className="flex items-center justify-end gap-2">
                        {loginUrl(provider) && (
                          <a
                            className="text-theme-xs text-brand-500 hover:text-brand-600 dark:text-brand-400"
                            href={loginUrl(provider)!}
                          >
                            Test login
                          </a>
                        )}
                        <button
                          type="button"
                          className="rounded-lg p-2 text-gray-500 hover:bg-error-50 hover:text-error-500 dark:hover:bg-error-500/10"
                          title="Delete provider"
                          onClick={() => {
                            if (window.confirm(`Delete provider "${provider.name}"?`)) {
                              deleteProvider.mutate(provider.id)
                            }
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="max-w-3xl text-theme-sm text-gray-500 dark:text-gray-400">
        OIDC redirect URI: <code className="text-gray-800 dark:text-white/90">{API_BASE}/auth/oidc/callback</code>.
        SAML ACS URL pattern:{' '}
        <code className="text-gray-800 dark:text-white/90">{API_BASE}/auth/saml/&lt;id&gt;/acs</code>.
        LDAP group → team mappings can be added via API after creating an LDAP provider.
      </p>
    </div>
  )
}
