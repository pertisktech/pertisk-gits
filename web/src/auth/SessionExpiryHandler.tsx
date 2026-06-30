import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from './AuthContext'
import { isJwtExpired, registerSessionExpiredHandler } from './session'

const JWT_CHECK_INTERVAL_MS = 60_000

export function SessionExpiryHandler() {
  const { clearSession, token } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const tokenRef = useRef(token)
  tokenRef.current = token

  const expireSessionRef = useRef<() => void>(() => {})
  expireSessionRef.current = () => {
    if (!tokenRef.current) return

    clearSession()
    queryClient.clear()

    const path = window.location.pathname
    if (path !== '/login' && path !== '/register') {
      navigate('/login', { replace: true, state: { reason: 'session_expired' } })
    }
  }

  useEffect(() => {
    registerSessionExpiredHandler(() => expireSessionRef.current())
    return () => registerSessionExpiredHandler(null)
  }, [])

  useEffect(() => {
    if (!token || !isJwtExpired(token)) return
    expireSessionRef.current()
  }, [token])

  useEffect(() => {
    if (!token) return

    const id = window.setInterval(() => {
      if (tokenRef.current && isJwtExpired(tokenRef.current)) {
        expireSessionRef.current()
      }
    }, JWT_CHECK_INTERVAL_MS)

    return () => window.clearInterval(id)
  }, [token])

  return null
}
