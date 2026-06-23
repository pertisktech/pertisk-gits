import { GitBranch, LayoutDashboard, Moon, Plus, Search, Sun, Users } from 'lucide-react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { cn } from '../utils/cn'
import { UserMenu } from './UserMenu'

const topNavClass = ({ isActive }: { isActive: boolean }) => cn(isActive && 'active')

export function AppLayout() {
  const { isDark, toggleTheme } = useTheme()
  const { user } = useAuth()

  return (
    <div className="flex flex-col h-screen bg-bg text-text">
      <header className="gogs-topbar shrink-0">
        <div className="gogs-topbar-inner">
          <NavLink to="/dashboard" className="gogs-brand">
            <img src="/favicon.svg" alt="" className="w-7 h-7" />
            <span>Pertisk Gits</span>
          </NavLink>

          <nav className="gogs-topnav hidden sm:flex">
            <NavLink to="/dashboard" className={topNavClass}>
              <span className="inline-flex items-center gap-1.5">
                <LayoutDashboard size={15} />
                Dashboard
              </span>
            </NavLink>
            <NavLink to="/groups" className={topNavClass}>
              <span className="inline-flex items-center gap-1.5">
                <Users size={15} />
                Repositories
              </span>
            </NavLink>
          </nav>

          <div className="hidden md:flex relative flex-1 max-w-xs">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
            <input
              type="search"
              placeholder="Search…"
              disabled
              className="w-full pl-8 pr-3 py-1.5 rounded-md border border-border bg-bg text-sm text-text placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-primary/40"
            />
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            {user && (
              <NavLink
                to="/groups/new"
                className="inline-flex items-center justify-center w-8 h-8 rounded-md border border-border text-text-secondary hover:bg-hover hover:text-primary"
                title="New group"
              >
                <Plus size={16} />
              </NavLink>
            )}
            <button
              type="button"
              onClick={toggleTheme}
              className="inline-flex items-center justify-center w-8 h-8 rounded-md border border-border text-text-secondary hover:bg-hover"
              data-no-global-button-hover="true"
              title={isDark ? 'Light mode' : 'Dark mode'}
            >
              {isDark ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            {user ? (
              <UserMenu />
            ) : (
              <Link
                to="/login"
                className="px-3 py-1.5 rounded-md border border-border text-sm text-text-secondary hover:bg-hover hover:text-primary"
              >
                Sign in
              </Link>
            )}
          </div>
        </div>
      </header>

      <main className="gogs-main">
        <div className="gogs-container">
          <Outlet />
        </div>
      </main>

      <footer className="shrink-0 border-t border-border bg-surface px-4 py-2 text-center text-xs text-muted">
        <span className="inline-flex items-center gap-1.5">
          <GitBranch size={12} className="text-primary" />
          Pertisk Gits · Git hosting
        </span>
      </footer>
    </div>
  )
}
