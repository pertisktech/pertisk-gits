import {
  ArrowLeft,
  Code2,
  CircleDot,
  FolderGit2,
  Gauge,
  GitCommit,
  GitPullRequest,
  HeartPulse,
  KeyRound,
  LayoutDashboard,
  Package,
  ScrollText,
  Server,
  Settings,
  Shield,
  SlidersHorizontal,
  UserCog,
  Users,
  Workflow,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { useAdminNav } from '../hooks/useAdminNav'
import { useGroupNav } from '../hooks/useGroupNav'
import { useProjectNav } from '../hooks/useProjectNav'
import { useSuperAdmin } from '../hooks/useSuperAdmin'
import type { AdminTab } from '../lib/adminRoute'
import { adminTabPath } from '../lib/adminRoute'
import type { GroupTab } from '../lib/groupRoute'
import { groupTabPath } from '../lib/groupRoute'
import type { ProjectTab } from '../lib/projectRoute'
import { projectTabPath } from '../lib/projectRoute'
import { cn } from '../utils/cn'
import { AppVersion } from './AppVersion'

const globalNavItems: { to: string; label: string; icon: LucideIcon; end?: boolean }[] = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/groups', label: 'Groups', icon: Users },
]

const projectNavItems: {
  id: ProjectTab
  label: string
  icon: LucideIcon
}[] = [
  { id: 'code', label: 'Code', icon: Code2 },
  { id: 'issues', label: 'Issues', icon: CircleDot },
  { id: 'pulls', label: 'Pull requests', icon: GitPullRequest },
  { id: 'commits', label: 'Commits', icon: GitCommit },
  { id: 'pipelines', label: 'Pipelines', icon: Workflow },
  { id: 'settings', label: 'Settings', icon: Settings },
]

const adminNavItems: { id: AdminTab; label: string; icon: LucideIcon }[] = [
  { id: 'system', label: 'System information', icon: Gauge },
  { id: 'health', label: 'Health check', icon: HeartPulse },
  { id: 'configuration', label: 'Configuration', icon: SlidersHorizontal },
  { id: 'users', label: 'Users', icon: UserCog },
  { id: 'runners', label: 'Runners', icon: Server },
]

const groupNavItems: { id: GroupTab; label: string; icon: LucideIcon }[] = [
  { id: 'repositories', label: 'Repositories', icon: FolderGit2 },
  { id: 'registry', label: 'Registry', icon: Package },
  { id: 'members', label: 'Members', icon: Users },
  { id: 'secrets', label: 'Secrets', icon: KeyRound },
  { id: 'audit', label: 'Audit log', icon: ScrollText },
  { id: 'settings', label: 'Settings', icon: Settings },
]

const globalLinkClass = ({ isActive }: { isActive: boolean }) =>
  cn('app-sidebar-link', isActive && 'active')

function projectLinkClass(active: boolean, nested = true) {
  return cn('app-sidebar-link', nested && 'app-sidebar-link-nested', active && 'active')
}

interface AppSidebarProps {
  open: boolean
}

export function AppSidebar({ open }: AppSidebarProps) {
  const project = useProjectNav()
  const group = useGroupNav()
  const admin = useAdminNav()
  const isSuperAdmin = useSuperAdmin()

  return (
    <aside id="app-sidebar" className={cn('app-sidebar', open && 'open')} aria-label="Main navigation">
      <div className="app-sidebar-header">
        <NavLink to="/dashboard" className="app-brand">
          <img src="/favicon.svg" alt="" className="w-7 h-7" />
          <span>Pertisk Gits</span>
        </NavLink>
      </div>

      <nav className="app-sidebar-nav">
        {!project && !group && !admin &&
          globalNavItems.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={globalLinkClass}>
              <Icon size={16} className="shrink-0" aria-hidden />
              <span>{label}</span>
            </NavLink>
          ))}

        {!project && !group && !admin && isSuperAdmin && (
          <NavLink to="/admin" className={globalLinkClass}>
            <Shield size={16} className="shrink-0" aria-hidden />
            <span>Admin</span>
          </NavLink>
        )}

        {admin && !project && !group && (
          <div className="app-sidebar-section">
            <p className="app-sidebar-section-label">Administration</p>
            <NavLink to="/dashboard" className="app-sidebar-back">
              <ArrowLeft size={14} aria-hidden />
              <span>Dashboard</span>
            </NavLink>

            {adminNavItems.map(({ id, label, icon: Icon }) => (
              <NavLink
                key={id}
                to={adminTabPath(admin.basePath, id)}
                end={id === 'system'}
                className={({ isActive }) => projectLinkClass(isActive, false)}
              >
                <Icon size={16} className="shrink-0" aria-hidden />
                <span>{label}</span>
              </NavLink>
            ))}
          </div>
        )}

        {group && !project && !admin && (
          <div className="app-sidebar-section">
            <p className="app-sidebar-section-label">Group</p>
            <NavLink to="/groups" className="app-sidebar-back">
              <ArrowLeft size={14} aria-hidden />
              <span>Groups</span>
            </NavLink>
            <p className="app-sidebar-project-name" title={group.groupName}>
              {group.groupName}
            </p>

            {groupNavItems
              .filter((item) => item.id !== 'audit' || group.canViewAudit)
              .filter((item) => item.id !== 'settings' || group.canManage)
              .map(({ id, label, icon: Icon }) => (
              <NavLink
                key={id}
                to={groupTabPath(group.basePath, id)}
                end={id === 'repositories'}
                className={({ isActive }) => projectLinkClass(isActive, false)}
              >
                <Icon size={16} className="shrink-0" aria-hidden />
                <span>{label}</span>
              </NavLink>
            ))}
          </div>
        )}

        {project && !admin && (
          <div className="app-sidebar-section">
            <p className="app-sidebar-section-label">Repository</p>
            <NavLink to={`/groups/${project.orgSlug}`} className="app-sidebar-back">
              <ArrowLeft size={14} aria-hidden />
              <span className="truncate">{project.orgSlug}</span>
            </NavLink>
            <p className="app-sidebar-project-name" title={project.projectName}>
              {project.projectName}
            </p>

            {projectNavItems
              .filter((item) => {
                if (item.id === 'pipelines') return project.showPipelinesTab
                if (item.id === 'settings') return project.showSettingsTab
                return true
              })
              .map(({ id, label, icon: Icon }) => (
                <NavLink
                  key={id}
                  to={projectTabPath(project.basePath, id)}
                  end={id === 'code'}
                  className={({ isActive }) => projectLinkClass(isActive, false)}
                >
                  <Icon size={16} className="shrink-0" aria-hidden />
                  <span>{label}</span>
                </NavLink>
              ))}
          </div>
        )}
      </nav>

      <div className="app-sidebar-footer">
        <AppVersion />
      </div>
    </aside>
  )
}
