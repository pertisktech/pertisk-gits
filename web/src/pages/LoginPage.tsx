import { useState, type FormEvent } from 'react'
import { GitBranch, Moon, Shield, Sun } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { useTheme } from '../context/ThemeContext'
import styles from './AuthPage.module.css'

export function LoginPage() {
  const { setSession } = useAuth()
  const { isDark, toggleTheme } = useTheme()
  const navigate = useNavigate()
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

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

        <p className={styles.linkRow} style={{ marginTop: '1rem' }}>
          New here? <Link to="/register">Create an account</Link>
        </p>
      </div>

      <footer className={styles.footer}>
        <p className={styles.version}>
          <GitBranch size={12} style={{ verticalAlign: -2, marginRight: 4 }} />
          Pertisk Gits · Phase 1
        </p>
      </footer>
    </div>
  )
}
