import { useState, type FormEvent } from 'react'
import { UserPlus } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { AuthLayout } from '../components/auth/AuthLayout'
import { Alert } from '../components/ui'
import { Button } from '../components/ui/Button'
import { FieldLabel, Input } from '../components/ui/Input'

export function RegisterPage() {
  const { setSession } = useAuth()
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
    <AuthLayout
      title="Create account"
      subtitle="Join your team on Pertisk Gits"
      icon={<UserPlus size={20} className="text-brand-500" />}
    >
      {error && <Alert className="mb-4">{error}</Alert>}

      <form onSubmit={onSubmit} className="space-y-4">
        <FieldLabel label="Username">
          <Input value={username} onChange={(e) => setUsername(e.target.value)} required />
        </FieldLabel>
        <FieldLabel label="Email">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </FieldLabel>
        <FieldLabel label="Password" hint="At least 8 characters">
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
          />
        </FieldLabel>
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? 'Creating…' : 'Create account'}
        </Button>
      </form>

      <p className="mt-6 text-center text-theme-sm text-gray-500 dark:text-gray-400">
        Already have an account?{' '}
        <Link to="/login" className="font-medium text-brand-500 hover:text-brand-600 no-underline">
          Sign in
        </Link>
      </p>
    </AuthLayout>
  )
}
