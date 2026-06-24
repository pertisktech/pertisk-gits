import { Menu, Moon, Plus, Sun, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { cn } from '../utils/cn'
import { AppSidebar } from './AppSidebar'
import { GlobalSearch } from './GlobalSearch'
import { UserMenu } from './UserMenu'

export function AppLayout() {
  const { isDark, toggleTheme } = useTheme()
  const { user } = useAuth()
  const location = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  useEffect(() => {
    setSidebarOpen(false)
  }, [location.pathname])

  return (
    <div className="app-shell">
      <div
        className={sidebarOpen ? 'app-sidebar-backdrop open' : 'app-sidebar-backdrop'}
        aria-hidden={!sidebarOpen}
        onClick={() => setSidebarOpen(false)}
      />

      <AppSidebar open={sidebarOpen} />

      <div className={cn('app-content', sidebarOpen && 'sidebar-open')}>
        <header className="app-content-top">
          <div className="app-content-top-inner">
            <button
              type="button"
              className="app-topbar-menu-btn md:hidden"
              aria-controls="app-sidebar"
              aria-expanded={sidebarOpen}
              aria-label={sidebarOpen ? 'Close navigation' : 'Open navigation'}
              data-no-global-button-hover="true"
              onClick={() => setSidebarOpen((open) => !open)}
            >
              <Menu
                size={18}
                className={sidebarOpen ? 'opacity-0 scale-90' : 'opacity-100'}
                aria-hidden={sidebarOpen}
              />
              <X
                size={18}
                className={sidebarOpen ? 'opacity-100' : 'opacity-0 scale-90'}
                aria-hidden={!sidebarOpen}
              />
            </button>

            <GlobalSearch />

            <div className="ml-auto flex items-center gap-1.5 shrink-0">
              {user && (
                <NavLink to="/groups/new" className="app-topbar-icon-btn" title="New group">
                  <Plus size={16} />
                </NavLink>
              )}
              <button
                type="button"
                onClick={toggleTheme}
                className="app-topbar-icon-btn"
                data-no-global-button-hover="true"
                title={isDark ? 'Light mode' : 'Dark mode'}
              >
                {isDark ? <Sun size={16} /> : <Moon size={16} />}
              </button>
              {user ? (
                <UserMenu />
              ) : (
                <Link to="/login" className="app-topbar-sign-in">
                  Sign in
                </Link>
              )}
            </div>
          </div>
        </header>

        <main className="app-main">
          <div className="app-container">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
