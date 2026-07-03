import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api } from '../api/client'
import type { User } from '../api/types'

interface AuthContextValue {
  token: string | null
  user: User | null
  setSession: (token: string, user: User) => void
  clearSession: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

const TOKEN_KEY = 'pertisk_token'
const USER_KEY = 'pertisk_user'

export function getStoredAuthToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function getStoredUser(): User | null {
  return loadUser()
}

function loadUser(): User | null {
  const raw = localStorage.getItem(USER_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as User
  } catch {
    return null
  }
}

function isSsoCallbackRoute(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.location.pathname === '/auth/callback'
    || window.location.search.includes('token=')
    || window.location.hash.includes('token=')
  )
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY))
  const [user, setUser] = useState<User | null>(() => loadUser())

  useEffect(() => {
    if (isSsoCallbackRoute()) return

    const storedToken = localStorage.getItem(TOKEN_KEY)
    if (!storedToken) return

    const storedUser = loadUser()
    if (storedUser) {
      if (!token) setToken(storedToken)
      if (!user) setUser(storedUser)
      return
    }

    if (user && token === storedToken) return

    let cancelled = false
    api
      .me(storedToken)
      .then(({ user: meUser, is_super_admin }) => {
        if (cancelled) return
        const nextUser = { ...meUser, is_super_admin }
        localStorage.setItem(TOKEN_KEY, storedToken)
        localStorage.setItem(USER_KEY, JSON.stringify(nextUser))
        setToken(storedToken)
        setUser(nextUser)
      })
      .catch(() => {
        if (cancelled) return
        localStorage.removeItem(TOKEN_KEY)
        localStorage.removeItem(USER_KEY)
        setToken(null)
        setUser(null)
      })

    return () => {
      cancelled = true
    }
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      token,
      user,
      setSession: (nextToken, nextUser) => {
        localStorage.setItem(TOKEN_KEY, nextToken)
        localStorage.setItem(USER_KEY, JSON.stringify(nextUser))
        setToken(nextToken)
        setUser(nextUser)
      },
      clearSession: () => {
        localStorage.removeItem(TOKEN_KEY)
        localStorage.removeItem(USER_KEY)
        setToken(null)
        setUser(null)
      },
    }),
    [token, user],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

/** Token from React state or localStorage (survives SSO callback full-page reload). */
export function useEffectiveAuthToken(): string | null {
  const { token } = useAuth()
  return token ?? getStoredAuthToken()
}

/** User from React state or localStorage. */
export function useEffectiveUser(): User | null {
  const { user } = useAuth()
  return user ?? getStoredUser()
}
