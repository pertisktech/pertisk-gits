import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'

export function AuthCallbackPage() {
  const [searchParams] = useSearchParams()
  const { setSession } = useAuth()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const token = searchParams.get('token')
    if (!token) {
      setError('Missing sign-in token')
      return
    }

    const decodedToken = (() => {
      try {
        return decodeURIComponent(token)
      } catch {
        return token
      }
    })()

    api
      .me(decodedToken)
      .then(({ user, is_super_admin }) => {
        setSession(decodedToken, { ...user, is_super_admin })
        // Full navigation so ProtectedRoute reads token from localStorage immediately.
        window.location.replace('/dashboard')
      })
      .catch((err: unknown) => {
        const message =
          err instanceof Error && err.message
            ? err.message
            : 'Could not complete sign-in'
        setError(message)
      })
  }, [searchParams, setSession])

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
