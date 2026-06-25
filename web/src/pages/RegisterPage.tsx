import { useState, type FormEvent } from 'react'
import { Moon, Sun, UserPlus } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { AppVersion } from '../components/AppVersion'
import { useTheme } from '../context/ThemeContext'
import styles from './AuthPage.module.css'

export function RegisterPage() {
  const { setSession } = useAuth()
  const { isDark, toggleTheme } = useTheme()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const response = await api.register({ username, email, password })
      setSession(response.token, { ...response.user, is_super_admin: response.is_super_admin })
      navigate('/dashboard')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={styles.wrap}>
      <header className={styles.topBar}>
        <button type="button" className={styles.themeToggle} onClick={toggleTheme} data-no-global-button-hover="true">
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
            <UserPlus size={20} /> Create account
          </h1>
          <p className={styles.subtitle}>Join your team on Pertisk Gits</p>
        </div>

        {error && <p className={styles.error}>{error}</p>}

        <form onSubmit={onSubmit} className={styles.form}>
          <label className={styles.label}>
            Username
            <input className={styles.input} value={username} onChange={(e) => setUsername(e.target.value)} required />
          </label>
          <label className={styles.label}>
            Email
            <input className={styles.input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label className={styles.label}>
            Password
            <input
              className={styles.input}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              required
            />
          </label>
          <button type="submit" className={styles.button} disabled={loading} data-no-global-button-hover="true">
            {loading ? 'Creating…' : 'Create account'}
          </button>
        </form>

        <p className={styles.linkRow} style={{ marginTop: '1rem' }}>
          Already have an account? <Link to="/login">Sign in</Link>
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
