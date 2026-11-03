import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from './AuthContext'
import { isJwtExpired, registerSessionExpiredHandler } from './session'

const JWT_CHECK_INTERVAL_MS = 60_000

/** Paths that remain usable without a session (GitHub-like public browse). */
function isPublicBrowsePath(pathname: string): boolean {
  if (pathname === '/' || pathname === '/dashboard' || pathname === '/groups') return true
  if (pathname.startsWith('/groups/')) {
    // Admin/member group tabs still require auth.
    if (
      /\/(settings|members|teams|roles|machine-users|audit|secrets|import)(\/|$)/.test(pathname)
      || /\/projects\/[^/]+\/new(\/|$)/.test(pathname)
      || /\/projects\/new(\/|$)/.test(pathname)
    ) {
      return false
    }
    return true
  }
  // Short org/repo URLs redirect into /groups/...
  if (/^\/[^/]+(\/[^/]+)?\/?$/.test(pathname)) {
    const first = pathname.split('/').filter(Boolean)[0]
    const reserved = new Set([
      'login',
      'register',
      'dashboard',
      'activity',
      'groups',
      'runners',
      'profile',
      'settings',
      'auth',
      'organizations',
      'api',
      'health',
      'assets',
      'admin',
    ])
    return Boolean(first && !reserved.has(first))
  }
  return false
}

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
    // Keep anonymous browse pages open; only bounce protected areas to login.
    if (isPublicBrowsePath(path)) return
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
