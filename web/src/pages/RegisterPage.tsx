import { useQuery } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { UserPlus } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { AppVersion } from '../components/AppVersion'
import styles from './AuthPage.module.css'

export function RegisterPage() {
  const { setSession } = useAuth()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pendingMessage, setPendingMessage] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const { data: registrationInfo } = useQuery({
    queryKey: ['registration-info'],
    queryFn: () => api.getRegistrationInfo(),
  })

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setLoading(true)
    setError(null)
    setPendingMessage(null)
    try {
      const response = await api.register({ username, email, password })
      if (response.pending_approval) {
        setPendingMessage(
          'Your account was created and is waiting for a super admin to approve it. You can sign in once approved.',
        )
        return
      }
      if (!response.token) {
        throw new Error('Registration succeeded but no session was issued')
      }
      setSession(response.token, {
        ...response.user,
        is_super_admin: response.is_super_admin ?? false,
      })
      navigate('/dashboard')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed')
    } finally {
      setLoading(false)
    }
  }

  if (registrationInfo && !registrationInfo.enabled) {
    return (
      <div className={styles.wrap}>
        <div className={styles.brand}>
          <img src="/logo.png" alt="" className={styles.brandLogo} />
          <span className={styles.brandName}>Pertisk Gits</span>
          <AppVersion variant="short" className={styles.brandVersion} />
        </div>

        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <h1 className={styles.title}>Registration disabled</h1>
            <p className={styles.subtitle}>New account sign-ups are not available on this instance.</p>
          </div>
          <p className={styles.linkRow}>
            <Link to="/login">Back to sign in</Link>
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.brand}>
        <img src="/logo.png" alt="" className={styles.brandLogo} />
        <span className={styles.brandName}>Pertisk Gits</span>
        <AppVersion variant="short" className={styles.brandVersion} />
      </div>

      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <h1 className={styles.title}>
            <UserPlus size={20} /> Create account
          </h1>
          <p className={styles.subtitle}>Join your Git platform</p>
        </div>

        <form className={styles.form} onSubmit={onSubmit}>
          <label className={styles.field}>
            <span>Username</span>
            <input value={username} onChange={(e) => setUsername(e.target.value)} required autoComplete="username" />
          </label>
          <label className={styles.field}>
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </label>
          <label className={styles.field}>
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="new-password"
            />
          </label>
          {error && <p className={styles.error}>{error}</p>}
          {pendingMessage && <p className={styles.pending}>{pendingMessage}</p>}
          <button type="submit" className={styles.submit} disabled={loading} data-no-global-button-hover="true">
            {loading ? 'Creating…' : 'Create account'}
          </button>
        </form>

        <p className={styles.linkRow}>
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  )
}
