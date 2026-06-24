import { LayoutDashboard, Server, Users } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { cn } from '../utils/cn'
import { AppVersion } from './AppVersion'

const navItems: { to: string; label: string; icon: LucideIcon; end?: boolean }[] = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/groups', label: 'Repositories', icon: Users },
  { to: '/runners', label: 'Runners', icon: Server },
]

const linkClass = ({ isActive }: { isActive: boolean }) =>
  cn('app-sidebar-link', isActive && 'active')

interface AppSidebarProps {
  open: boolean
}

export function AppSidebar({ open }: AppSidebarProps) {
  return (
    <aside id="app-sidebar" className={cn('app-sidebar', open && 'open')} aria-label="Main navigation">
      <nav className="app-sidebar-nav">
        {navItems.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={linkClass}>
            <Icon size={16} className="shrink-0" aria-hidden />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="app-sidebar-footer">
        <AppVersion />
      </div>
    </aside>
  )
}
