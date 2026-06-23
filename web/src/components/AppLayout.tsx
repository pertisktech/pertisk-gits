import { GitBranch, LayoutDashboard, Moon, Search, Sun, Users } from 'lucide-react'
import { NavLink, Outlet } from 'react-router-dom'
import { useTheme } from '../context/ThemeContext'
import { cn } from '../utils/cn'
import { UserMenu } from './UserMenu'

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'flex items-center gap-3 px-4 py-2 rounded-lg transition-colors text-[14px] font-medium',
    isActive
      ? 'bg-hover text-primary font-semibold'
      : 'text-text-secondary hover:bg-hover hover:text-text',
  )

export function AppLayout() {
  const { isDark, toggleTheme } = useTheme()

  return (
    <div className="flex h-screen bg-bg text-text">
      <aside className="w-64 shrink-0 bg-sidebar border-r border-border shadow-lg flex flex-col">
        <div className="h-[63px] flex items-center gap-3 px-4 border-b border-border">
          <img src="/favicon.svg" alt="" className="w-8 h-8" />
          <div>
            <div className="font-bold text-text leading-tight">Pertisk Gits</div>
            <div className="text-xs text-text-secondary">Git platform</div>
          </div>
        </div>

        <nav className="flex-1 overflow-auto p-3 space-y-1">
          <div className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
            Your work
          </div>
          <NavLink to="/dashboard" className={navLinkClass}>
            <LayoutDashboard size={16} />
            Dashboard
          </NavLink>
          <NavLink to="/groups" className={navLinkClass}>
            <Users size={16} />
            Groups
          </NavLink>

          <div className="px-4 pt-4 pb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
            Quick create
          </div>
          <NavLink to="/groups/new" className={navLinkClass}>
            <Users size={16} />
            New group
          </NavLink>
        </nav>

        <div className="p-3 border-t border-border text-xs text-text-secondary">
          <div className="flex items-center gap-2 px-2">
            <GitBranch size={14} className="text-primary" />
            Phase 1 · Git HTTP
          </div>
        </div>
      </aside>

      <div className="flex flex-col flex-1 min-w-0">
        <header className="bg-surface border-b border-border px-4 py-3 flex items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              type="search"
              placeholder="Search groups and projects…"
              disabled
              className="w-full pl-9 pr-3 py-1.5 rounded-lg border border-border bg-surface text-sm text-text placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={toggleTheme}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border text-text-secondary hover:bg-hover hover:text-text text-sm"
              data-no-global-button-hover="true"
              title={isDark ? 'Light mode' : 'Dark mode'}
            >
              {isDark ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <UserMenu />
          </div>
        </header>

        <main className="flex-1 overflow-auto bg-bg p-4 min-h-0">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
