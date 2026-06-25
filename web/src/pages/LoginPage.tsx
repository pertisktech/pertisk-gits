import { useQuery } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Moon, Shield, Sun } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import type { AuthProviderPublic } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { AppVersion } from '../components/AppVersion'
import { useTheme } from '../context/ThemeContext'
import styles from './AuthPage.module.css'

const API_BASE = import.meta.env.VITE_API_BASE ?? '/api/v1'

export function LoginPage() {
  const { setSession } = useAuth()
  const { isDark, toggleTheme } = useTheme()
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
      setSession(response.token, response.user)
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
        <img src="/favicon.svg" alt="" className={styles.brandLogo} />
        <span className={styles.brandName}>Pertisk Gits</span>
      </div>

      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <h1 className={styles.title}>
            <Shield size={20} /> Welcome back
          </h1>
          <p className={styles.subtitle}>Sign in to your Git platform</p>
        </div>

        {error && <p className={styles.error}>{error}</p>}

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

        {oidcProviders.length > 0 && (
          <div className={styles.linkRow} style={{ marginTop: '1.25rem' }}>
            <p className="text-sm text-text-secondary mb-2">Or continue with</p>
            <div className="flex flex-col gap-2">
              {oidcProviders.map((provider) => (
                <a
                  key={provider.id}
                  href={ssoLoginUrl(provider)}
                  className={styles.button}
                  style={{ textAlign: 'center', textDecoration: 'none' }}
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
      </div>

      <footer className={styles.footer}>
        <p className={styles.version}>
          <AppVersion />
        </p>
      </footer>
    </div>
  )
}
