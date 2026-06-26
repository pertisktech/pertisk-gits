import { useQuery } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Shield } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import type { AuthProviderPublic } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { AuthLayout } from '../components/auth/AuthLayout'
import { Alert } from '../components/ui'
import { Button } from '../components/ui/Button'
import { FieldLabel, Input } from '../components/ui/Input'

const API_BASE = import.meta.env.VITE_API_BASE ?? '/api/v1'

export function LoginPage() {
  const { setSession } = useAuth()
  const navigate = useNavigate()
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [ldapUser, setLdapUser] = useState('')
  const [ldapPass, setLdapPass] = useState('')
  const [ldapLoading, setLdapLoading] = useState(false)

  const { data: providers = [] } = useQuery({
    queryKey: ['auth-providers'],
    queryFn: () => api.listAuthProviders(),
  })

  const oidcProviders = providers.filter((p) => p.provider_type === 'oidc' || p.provider_type === 'saml')
  const ldapProviders = providers.filter((p) => p.provider_type === 'ldap')

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const response = await api.login({ login, password })
      setSession(response.token, { ...response.user, is_super_admin: response.is_super_admin })
      navigate('/dashboard')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  function ssoLoginUrl(provider: AuthProviderPublic) {
    if (provider.provider_type === 'oidc') {
      return `${API_BASE}/auth/oidc/${provider.id}/login`
    }
    return `${API_BASE}/auth/saml/${provider.id}/login`
  }

  async function onLdapSubmit(event: FormEvent, providerId: string) {
    event.preventDefault()
    setLdapLoading(true)
    setError(null)
    try {
      const response = await api.ldapLogin(providerId, {
        username: ldapUser,
        password: ldapPass,
      })
      setSession(response.token, response.user)
      navigate('/dashboard')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'LDAP login failed')
    } finally {
      setLdapLoading(false)
    }
  }

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in to your Git platform"
      icon={<Shield size={20} className="text-brand-500" />}
    >
      {error && <Alert className="mb-4">{error}</Alert>}

      <form onSubmit={onSubmit} className="space-y-4">
        <FieldLabel label="Username or email">
          <Input
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            autoComplete="username"
            required
          />
        </FieldLabel>
        <FieldLabel label="Password">
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </FieldLabel>
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>

      {oidcProviders.length > 0 && (
        <div className="mt-6 space-y-3 border-t border-gray-200 pt-6 dark:border-gray-800">
          <p className="text-center text-theme-sm text-gray-500 dark:text-gray-400">Or continue with</p>
          <div className="flex flex-col gap-2">
            {oidcProviders.map((provider) => (
              <a
                key={provider.id}
                href={ssoLoginUrl(provider)}
                className="inline-flex w-full items-center justify-center rounded-lg bg-brand-500 px-4 py-2.5 text-theme-sm font-medium text-white shadow-theme-xs hover:bg-brand-600 no-underline"
              >
                {provider.name}
              </a>
            ))}
          </div>
        </div>
      )}

      {ldapProviders.map((provider) => (
        <form
          key={provider.id}
          className="mt-6 space-y-4 border-t border-gray-200 pt-6 dark:border-gray-800"
          onSubmit={(e) => onLdapSubmit(e, provider.id)}
        >
          <p className="text-theme-sm text-gray-500 dark:text-gray-400">{provider.name} (LDAP)</p>
          <FieldLabel label="Username">
            <Input value={ldapUser} onChange={(e) => setLdapUser(e.target.value)} required />
          </FieldLabel>
          <FieldLabel label="Password">
            <Input
              type="password"
              value={ldapPass}
              onChange={(e) => setLdapPass(e.target.value)}
              required
            />
          </FieldLabel>
          <Button type="submit" className="w-full" disabled={ldapLoading}>
            {ldapLoading ? 'Signing in…' : `Sign in with ${provider.name}`}
          </Button>
        </form>
      ))}

      <p className="mt-6 text-center text-theme-sm text-gray-500 dark:text-gray-400">
        New here?{' '}
        <Link to="/register" className="font-medium text-brand-500 hover:text-brand-600 no-underline">
          Create an account
        </Link>
      </p>
    </AuthLayout>
  )
}
