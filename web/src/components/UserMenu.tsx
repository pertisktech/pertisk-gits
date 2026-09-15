import { useQueryClient } from '@tanstack/react-query'
import { Shield, LogOut, User } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { getAuth0Client, isAuth0Provider } from '../auth/auth0'
import { useAuth } from '../auth/AuthContext'
import { useSuperAdmin } from '../hooks/useSuperAdmin'
import { Avatar } from './primitives'
import { cn } from '../utils/cn'

export function UserMenu() {
  const { user, clearSession } = useAuth()
  const isSuperAdmin = useSuperAdmin()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  async function signOut() {
    setOpen(false)
    clearSession()
    queryClient.clear()

    try {
      const providers = await api.listAuthProviders()
      const oidc = providers.find(isAuth0Provider)
      if (oidc) {
        const client = await getAuth0Client({
          domain: oidc.oidc_domain,
          clientId: oidc.oidc_client_id,
        })
        await client.logout({
          logoutParams: {
            returnTo: `${window.location.origin}/login`,
          },
        })
        return
      }
    } catch {
      // fall through to local login page
    }

    window.location.replace('/login')
  }

  if (!user) return null

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        className="inline-flex items-center gap-2 rounded-lg border border-border bg-card/60 py-1 pl-1 pr-2 transition-colors hover:border-primary/40"
        data-no-global-button-hover="true"
        onClick={() => setOpen((v) => !v)}
      >
        <Avatar name={user.username} />
        <span className="text-sm font-medium text-text hidden sm:inline">@{user.username}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-44 overflow-hidden rounded-lg border border-border bg-[var(--color-surface-elevated)] p-1 shadow-lg z-50">
          <div className="px-3 py-2 border-b border-border mb-1">
            <div className="font-medium text-text text-sm">{user.display_name ?? user.username}</div>
            <div className="text-xs text-muted">@{user.username}</div>
          </div>
          {isSuperAdmin && (
            <Link
              to="/admin"
              className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted hover:bg-accent hover:text-text"
              onClick={() => setOpen(false)}
            >
              <Shield size={14} />
              Admin
            </Link>
          )}
          <Link
            to="/profile"
            className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted hover:bg-accent hover:text-text"
            onClick={() => setOpen(false)}
          >
            <User size={14} />
            Profile
          </Link>
          <button
            type="button"
            className={cn(
              'w-full flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted hover:bg-accent hover:text-text text-left',
            )}
            data-no-global-button-hover="true"
            onClick={() => void signOut()}
          >
            <LogOut size={14} />
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}
