import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'

function readCallbackToken(searchParams: URLSearchParams): string | null {
  const fromQuery = searchParams.get('token')
  if (fromQuery) {
    try {
      return decodeURIComponent(fromQuery)
    } catch {
      return fromQuery
    }
  }

  const hash = window.location.hash
  const prefix = '#token='
  if (hash.startsWith(prefix)) {
    const raw = hash.slice(prefix.length)
    try {
      return decodeURIComponent(raw)
    } catch {
      return raw
    }
  }

  return null
}

export function AuthCallbackPage() {
  const [searchParams] = useSearchParams()
  const { setSession, clearSession } = useAuth()
  const [error, setError] = useState<string | null>(null)
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true

    const decodedToken = readCallbackToken(searchParams)
    if (!decodedToken) {
      setError('Missing sign-in token')
      return
    }

    clearSession()

    api
      .me(decodedToken)
      .then(({ user, is_super_admin }) => {
        setSession(decodedToken, { ...user, is_super_admin })
        window.history.replaceState(null, '', '/auth/callback')
        window.location.replace('/dashboard')
      })
      .catch((err: unknown) => {
        const message =
          err instanceof Error && err.message
            ? err.message
            : 'Could not complete sign-in'
        setError(message)
      })
  }, [searchParams, setSession, clearSession])

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
