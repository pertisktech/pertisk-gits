import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'

export function AuthCallbackPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { setSession } = useAuth()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const token = searchParams.get('token')
    if (!token) {
      setError('Missing sign-in token')
      return
    }

    api
      .me(token)
      .then(({ user }) => {
        setSession(token, user)
        navigate('/dashboard', { replace: true })
      })
      .catch(() => setError('Could not complete sign-in'))
  }, [navigate, searchParams, setSession])

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="app-panel max-w-md w-full p-6 text-center">
          <p className="text-dashboard-danger mb-4">{error}</p>
          <a href="/login" className="text-accent hover:underline">
            Back to login
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center text-text-secondary text-sm">
      Completing sign-in…
    </div>
  )
}
