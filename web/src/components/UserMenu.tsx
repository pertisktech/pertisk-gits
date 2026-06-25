import { KeyRound, LogOut, User } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { cn } from '../utils/cn'

function initials(username: string) {
  return username.slice(0, 2).toUpperCase()
}

export function UserMenu() {
  const { user, clearSession } = useAuth()
  const navigate = useNavigate()
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

  if (!user) return null

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        className="inline-flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-hover"
        data-no-global-button-hover="true"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="w-7 h-7 rounded-full bg-primary-p4 text-naturals-n14 font-semibold text-xs inline-flex items-center justify-center">
          {initials(user.username)}
        </span>
        <span className="text-sm text-text hidden sm:inline">@{user.username}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 min-w-[200px] bg-surface border border-naturals-n4 rounded-lg shadow-md z-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-naturals-n4">
            <div className="font-medium text-text">{user.display_name ?? user.username}</div>
            <div className="text-xs text-text-secondary">@{user.username}</div>
          </div>
          <Link
            to="/settings/auth"
            className="flex items-center gap-2 px-4 py-2.5 text-sm text-text hover:bg-hover"
            onClick={() => setOpen(false)}
          >
            <KeyRound size={14} />
            SSO / LDAP
          </Link>
          <Link
            to="/profile"
            className="flex items-center gap-2 px-4 py-2.5 text-sm text-text hover:bg-hover"
            onClick={() => setOpen(false)}
          >
            <User size={14} />
            Profile
          </Link>
          <button
            type="button"
            className={cn(
              'w-full flex items-center gap-2 px-4 py-2.5 text-sm text-text hover:bg-hover text-left',
            )}
            data-no-global-button-hover="true"
            onClick={() => {
              clearSession()
              navigate('/login')
            }}
          >
            <LogOut size={14} />
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}
