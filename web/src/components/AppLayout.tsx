import { LayoutDashboard, Moon, Plus, Server, Sun, Users } from 'lucide-react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { cn } from '../utils/cn'
import { AppVersion } from './AppVersion'
import { GlobalSearch } from './GlobalSearch'
import { UserMenu } from './UserMenu'

const topNavClass = ({ isActive }: { isActive: boolean }) => cn(isActive && 'active')

export function AppLayout() {
  const { isDark, toggleTheme } = useTheme()
  const { user } = useAuth()

  return (
    <div className="gogs-shell text-text">
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
            <NavLink to="/runners" className={topNavClass}>
              <span className="inline-flex items-center gap-1.5">
                <Server size={15} />
                Runners
              </span>
            </NavLink>
          </nav>

          <GlobalSearch />

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
        <AppVersion />
      </footer>
    </div>
  )
}
