import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
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
      .then(({ user, is_super_admin }) => {
        setSession(token, { ...user, is_super_admin })
        navigate('/dashboard', { replace: true })
      })
      .catch(() => setError('Could not complete sign-in'))
  }, [navigate, searchParams, setSession])

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="shell-card w-full max-w-md p-6 text-center">
          <p className="mb-4 text-theme-sm text-error-500">{error}</p>
          <Link to="/login" className="text-theme-sm text-brand-500 hover:underline dark:text-brand-400">
            Back to login
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center text-theme-sm text-gray-500 dark:text-gray-400">
      Completing sign-in…
    </div>
  )
}
