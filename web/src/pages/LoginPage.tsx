import { useQuery } from '@tanstack/react-query'
import { useEffect, useState, type FormEvent } from 'react'
import { Moon, Shield, Sun } from 'lucide-react'
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import type { AuthProviderPublic } from '../api/types'
import { getAuth0Client, isAuth0Provider } from '../auth/auth0'
import { getStoredAuthToken, useAuth } from '../auth/AuthContext'
import { isJwtExpired } from '../auth/session'
import { AppVersion } from '../components/AppVersion'
import { useTheme } from '../context/ThemeContext'
import styles from './AuthPage.module.css'

const API_BASE = import.meta.env.VITE_API_BASE ?? '/api/v1'

export function LoginPage() {
  const { setSession, token, clearSession } = useAuth()
  const { isDark, toggleTheme } = useTheme()
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const sessionExpired = (location.state as { reason?: string } | null)?.reason === 'session_expired'
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(() => {
    const raw = searchParams.get('error')
    if (!raw) return null
    try {
      return decodeURIComponent(raw.replace(/\+/g, ' '))
    } catch {
      return raw
    }
  })
  const [loading, setLoading] = useState(false)
  const [ssoRedirecting, setSsoRedirecting] = useState(false)
  const [ldapUser, setLdapUser] = useState('')
  const [ldapPass, setLdapPass] = useState('')
  const [ldapLoading, setLdapLoading] = useState(false)

  const { data: providers = [] } = useQuery({
    queryKey: ['auth-providers'],
    queryFn: () => api.listAuthProviders(),
  })

  const oidcProviders = providers.filter((p) => p.provider_type === 'oidc')
  const samlProviders = providers.filter((p) => p.provider_type === 'saml')
  const ldapProviders = providers.filter((p) => p.provider_type === 'ldap')

  useEffect(() => {
    setSsoRedirecting(false)
    const stored = getStoredAuthToken()
    if (stored && isJwtExpired(stored)) {
      clearSession()
    }
  }, [clearSession])

  useEffect(() => {
    let cancelled = false

    async function handleAuth0Redirect() {
      if (!searchParams.has('code') || !searchParams.has('state')) return
      if (providers.length === 0) return

      const auth0Providers = providers.filter(isAuth0Provider)
      if (auth0Providers.length === 0) return

      setSsoRedirecting(true)
      setError(null)

      try {
        let matchedProvider: (typeof auth0Providers)[number] | null = null
        let providerId = auth0Providers[0].id
        let lastError: unknown = null

        for (const candidate of auth0Providers) {
          try {
            const client = await getAuth0Client({
              domain: candidate.oidc_domain,
              clientId: candidate.oidc_client_id,
            })
            const result = await client.handleRedirectCallback()
            matchedProvider = candidate
            providerId =
              (result.appState as { providerId?: string } | undefined)?.providerId ?? candidate.id
            break
          } catch (err) {
            lastError = err
          }
        }

        if (!matchedProvider) {
          throw lastError instanceof Error ? lastError : new Error('SSO login failed')
        }

        const client = await getAuth0Client({
          domain: matchedProvider.oidc_domain,
          clientId: matchedProvider.oidc_client_id,
        })
        const claims = await client.getIdTokenClaims()
        const idToken = claims?.__raw
        if (!idToken) {
          throw new Error('Missing identity token from Auth0')
        }

        const response = await api.completeOidcSession(providerId, { id_token: idToken })
        if (cancelled) return

        setSession(response.token, { ...response.user, is_super_admin: response.is_super_admin })
        navigate('/dashboard', { replace: true })
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'SSO login failed')
        setSsoRedirecting(false)
        window.history.replaceState({}, '', '/login')
      }
    }

    void handleAuth0Redirect()
    return () => {
      cancelled = true
    }
  }, [providers, searchParams, setSession, navigate])

  const storedToken = getStoredAuthToken()
  const validStoredToken = storedToken && !isJwtExpired(storedToken) ? storedToken : null
  if (token ?? validStoredToken) {
    return <Navigate to="/dashboard" replace />
  }

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

  async function startOidcLogin(provider: AuthProviderPublic) {
    if (ssoRedirecting || !isAuth0Provider(provider)) return
    setSsoRedirecting(true)
    setError(null)
    clearSession()

    try {
      const client = await getAuth0Client({
        domain: provider.oidc_domain,
        clientId: provider.oidc_client_id,
      })
      await client.loginWithRedirect({
        appState: { providerId: provider.id },
        authorizationParams: {
          prompt: 'login',
        },
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'SSO login failed')
      setSsoRedirecting(false)
    }
  }

  function startSamlLogin(provider: AuthProviderPublic) {
    if (ssoRedirecting) return
    setSsoRedirecting(true)
    setError(null)
    clearSession()
    window.location.assign(`${API_BASE}/auth/saml/${provider.id}/login`)
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

  const ssoBusy = ssoRedirecting || (searchParams.has('code') && searchParams.has('state'))

  return (
    <div className={styles.wrap}>
      <header className={styles.topBar}>
        <button
          type="button"
          className={styles.themeToggle}
          onClick={toggleTheme}
          data-no-global-button-hover="true"
        >
          {isDark ? <Sun size={16} /> : <Moon size={16} />}
          {isDark ? 'Light' : 'Dark'}
        </button>
      </header>

      <div className={styles.brand}>
        <img src="/logo.png" alt="" className={styles.brandLogo} />
        <span className={styles.brandName}>Pertisk Gits</span>
      </div>

      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <h1 className={styles.title}>
            <Shield size={20} /> Welcome back
          </h1>
          <p className={styles.subtitle}>Sign in to your Git platform</p>
        </div>

        {sessionExpired && !error && (
          <p className={styles.error}>Your session has expired. Please sign in again.</p>
        )}
        {error && <p className={styles.error}>{error}</p>}
        {ssoBusy && !error && (
          <p className={styles.subtitle}>Completing sign-in…</p>
        )}

        {!ssoBusy && (
          <>
            <form onSubmit={onSubmit} className={styles.form}>
              <label className={styles.label}>
                Username or email
                <input
                  className={styles.input}
                  value={login}
                  onChange={(e) => setLogin(e.target.value)}
                  autoComplete="username"
                  required
                />
              </label>
              <label className={styles.label}>
                Password
                <input
                  className={styles.input}
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
              </label>
              <button type="submit" className={styles.button} disabled={loading} data-no-global-button-hover="true">
                {loading ? 'Signing in…' : 'Sign in'}
              </button>
            </form>

            {(oidcProviders.length > 0 || samlProviders.length > 0) && (
              <div className={styles.linkRow} style={{ marginTop: '1.25rem' }}>
                <p className="text-sm text-text-secondary mb-2">Or continue with</p>
                <div className="flex flex-col gap-2">
                  {oidcProviders.map((provider) => (
                    <button
                      key={provider.id}
                      type="button"
                      className={styles.button}
                      disabled={ssoRedirecting}
                      onClick={() => void startOidcLogin(provider)}
                      data-no-global-button-hover="true"
                    >
                      {ssoRedirecting ? 'Redirecting…' : provider.name}
                    </button>
                  ))}
                  {samlProviders.map((provider) => (
                    <button
                      key={provider.id}
                      type="button"
                      className={styles.button}
                      disabled={ssoRedirecting}
                      onClick={() => startSamlLogin(provider)}
                      data-no-global-button-hover="true"
                    >
                      {ssoRedirecting ? 'Redirecting…' : provider.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {ldapProviders.map((provider) => (
              <form
                key={provider.id}
                className={styles.form}
                style={{ marginTop: '1rem', borderTop: '1px solid var(--border)', paddingTop: '1rem' }}
                onSubmit={(e) => onLdapSubmit(e, provider.id)}
              >
                <p className="text-sm text-text-secondary mb-2">{provider.name} (LDAP)</p>
                <label className={styles.label}>
                  Username
                  <input
                    className={styles.input}
                    value={ldapUser}
                    onChange={(e) => setLdapUser(e.target.value)}
                    required
                  />
                </label>
                <label className={styles.label}>
                  Password
                  <input
                    className={styles.input}
                    type="password"
                    value={ldapPass}
                    onChange={(e) => setLdapPass(e.target.value)}
                    required
                  />
                </label>
                <button
                  type="submit"
                  className={styles.button}
                  disabled={ldapLoading}
                  data-no-global-button-hover="true"
                >
                  {ldapLoading ? 'Signing in…' : `Sign in with ${provider.name}`}
                </button>
              </form>
            ))}

            <p className={styles.linkRow} style={{ marginTop: '1rem' }}>
              New here? <Link to="/register">Create an account</Link>
            </p>
          </>
        )}
      </div>

      <footer className={styles.footer}>
        <p className={styles.version}>
          <AppVersion />
        </p>
      </footer>
    </div>
  )
}
