import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from './AuthContext'
import { isJwtExpired, registerSessionExpiredHandler } from './session'

const JWT_CHECK_INTERVAL_MS = 60_000

export function SessionExpiryHandler() {
  const { clearSession, token } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()

  const expireSession = useCallback(() => {
    clearSession()
    queryClient.clear()
    if (location.pathname !== '/login' && location.pathname !== '/register') {
      navigate('/login', { replace: true, state: { reason: 'session_expired' } })
    }
  }, [clearSession, location.pathname, navigate, queryClient])

  useEffect(() => {
    registerSessionExpiredHandler(expireSession)
    return () => registerSessionExpiredHandler(null)
  }, [expireSession])

  useEffect(() => {
    if (token && isJwtExpired(token)) {
      expireSession()
    }
  }, [token, expireSession])

  useEffect(() => {
    if (!token) return

    const id = window.setInterval(() => {
      if (isJwtExpired(token)) {
        expireSession()
      }
    }, JWT_CHECK_INTERVAL_MS)

    return () => window.clearInterval(id)
  }, [token, expireSession])

  return null
}
