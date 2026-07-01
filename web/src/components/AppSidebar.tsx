import {
  ArrowLeft,
  BookOpen,
  Bot,
  ChevronLeft,
  ChevronRight,
  Code2,
  CircleDot,
  Download,
  FolderGit2,
  Gauge,
  GitBranch,
  GitCommit,
  GitPullRequest,
  HardDrive,
  HeartPulse,
  KeyRound,
  LayoutDashboard,
  Package,
  ScrollText,
  Server,
  Settings,
  Shield,
  SlidersHorizontal,
  Tag,
  UserCheck,
  UserCog,
  Users,
  UsersRound,
  Workflow,
  Zap,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { useActivityNav } from '../hooks/useActivityNav'
import { useAdminNav } from '../hooks/useAdminNav'
import { useGroupNav } from '../hooks/useGroupNav'
import { useProjectNav } from '../hooks/useProjectNav'
import { useSuperAdmin } from '../hooks/useSuperAdmin'
import type { ActivityTab } from '../lib/activityRoute'
import { activityTabPath } from '../lib/activityRoute'
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
  { to: '/activity/merge-requests', label: 'Activity', icon: Zap, end: false },
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
  { id: 'branches', label: 'Branches', icon: GitBranch },
  { id: 'tags', label: 'Tags', icon: Tag },
  { id: 'wiki', label: 'Wiki', icon: BookOpen },
  { id: 'pipelines', label: 'Pipelines', icon: Workflow },
  { id: 'settings', label: 'Settings', icon: Settings },
]

const activityNavItems: { id: ActivityTab; label: string; icon: LucideIcon; superAdminOnly?: boolean }[] = [
  { id: 'merge-requests', label: 'Merge requests', icon: GitPullRequest },
  { id: 'approve-users', label: 'Approve users', icon: UserCheck, superAdminOnly: true },
]

const adminNavItems: { id: AdminTab; label: string; icon: LucideIcon }[] = [
  { id: 'system', label: 'System information', icon: Gauge },
  { id: 'health', label: 'Health check', icon: HeartPulse },
  { id: 'configuration', label: 'Configuration', icon: SlidersHorizontal },
  { id: 'auth', label: 'SSO / LDAP', icon: KeyRound },
  { id: 'users', label: 'Users', icon: UserCog },
  { id: 'backups', label: 'Backups', icon: HardDrive },
  { id: 'runners', label: 'Runners', icon: Server },
]

const groupNavItems: { id: GroupTab; label: string; icon: LucideIcon }[] = [
  { id: 'repositories', label: 'Repositories', icon: FolderGit2 },
  { id: 'registry', label: 'Registry', icon: Package },
  { id: 'members', label: 'Members', icon: Users },
  { id: 'teams', label: 'Teams', icon: UsersRound },
  { id: 'roles', label: 'Custom roles', icon: Shield },
  { id: 'machine-users', label: 'Machine users', icon: Bot },
  { id: 'secrets', label: 'Secrets', icon: KeyRound },
  { id: 'import', label: 'Import', icon: Download },
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
  collapsed: boolean
  onToggleCollapse: () => void
}

export function AppSidebar({ open, collapsed, onToggleCollapse }: AppSidebarProps) {
  const project = useProjectNav()
  const group = useGroupNav()
  const admin = useAdminNav()
  const activity = useActivityNav()
  const isSuperAdmin = useSuperAdmin()

  return (
    <aside
      id="app-sidebar"
      className={cn('app-sidebar', open && 'open', collapsed && 'collapsed')}
      aria-label="Main navigation"
      aria-expanded={!collapsed}
    >
      <div className="app-sidebar-header">
        <NavLink
          to="/dashboard"
          className="app-brand"
          title={collapsed ? 'Pertisk Gits' : undefined}
        >
          <img src="/logo.png" alt="" className="w-7 h-7 shrink-0 object-contain" />
          <span>Pertisk Gits</span>
        </NavLink>
        <button
          type="button"
          className="app-sidebar-collapse-btn"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          data-no-global-button-hover="true"
          onClick={onToggleCollapse}
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>

      <nav className="app-sidebar-nav">
        {!project && !group && !admin && !activity &&
          globalNavItems.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              title={collapsed ? label : undefined}
              className={globalLinkClass}
            >
              <Icon size={16} className="shrink-0" aria-hidden />
              <span>{label}</span>
            </NavLink>
          ))}

        {!project && !group && !admin && !activity && isSuperAdmin && (
          <NavLink to="/admin" className={globalLinkClass} title={collapsed ? 'Admin' : undefined}>
            <Shield size={16} className="shrink-0" aria-hidden />
            <span>Admin</span>
          </NavLink>
        )}

        {activity && !project && !group && !admin && (
          <div className="app-sidebar-section">
            <p className="app-sidebar-section-label">Activity</p>
            <NavLink to="/dashboard" className="app-sidebar-back" title={collapsed ? 'Dashboard' : undefined}>
              <ArrowLeft size={14} aria-hidden />
              <span>Dashboard</span>
            </NavLink>

            {activityNavItems
              .filter((item) => !item.superAdminOnly || isSuperAdmin)
              .map(({ id, label, icon: Icon }) => (
                <NavLink
                  key={id}
                  to={activityTabPath(activity.basePath, id)}
                  title={collapsed ? label : undefined}
                  className={({ isActive }) => projectLinkClass(isActive, false)}
                >
                  <Icon size={16} className="shrink-0" aria-hidden />
                  <span>{label}</span>
                </NavLink>
              ))}
          </div>
        )}

        {admin && !project && !group && !activity && (
          <div className="app-sidebar-section">
            <p className="app-sidebar-section-label">Administration</p>
            <NavLink to="/dashboard" className="app-sidebar-back" title={collapsed ? 'Dashboard' : undefined}>
              <ArrowLeft size={14} aria-hidden />
              <span>Dashboard</span>
            </NavLink>

            {adminNavItems.map(({ id, label, icon: Icon }) => (
              <NavLink
                key={id}
                to={adminTabPath(admin.basePath, id)}
                end={id === 'system'}
                title={collapsed ? label : undefined}
                className={({ isActive }) => projectLinkClass(isActive, false)}
              >
                <Icon size={16} className="shrink-0" aria-hidden />
                <span>{label}</span>
              </NavLink>
            ))}
          </div>
        )}

        {group && !project && !admin && !activity && (
          <div className="app-sidebar-section">
            <p className="app-sidebar-section-label">Group</p>
            <NavLink to="/groups" className="app-sidebar-back" title={collapsed ? 'Groups' : undefined}>
              <ArrowLeft size={14} aria-hidden />
              <span>Groups</span>
            </NavLink>
            <p className="app-sidebar-project-name" title={group.groupName}>
              {group.groupName}
            </p>

            {groupNavItems
              .filter((item) => item.id !== 'audit' || group.canViewAudit)
              .filter((item) => item.id !== 'import' || group.canManage)
              .filter((item) => item.id !== 'settings' || group.canManage)
              .filter((item) => (item.id !== 'teams' && item.id !== 'roles' && item.id !== 'machine-users') || group.canManage)
              .map(({ id, label, icon: Icon }) => (
              <NavLink
                key={id}
                to={groupTabPath(group.basePath, id)}
                end={id === 'repositories'}
                title={collapsed ? label : undefined}
                className={({ isActive }) => projectLinkClass(isActive, false)}
              >
                <Icon size={16} className="shrink-0" aria-hidden />
                <span>{label}</span>
              </NavLink>
            ))}
          </div>
        )}

        {project && !admin && !activity && (
          <div className="app-sidebar-section">
            <p className="app-sidebar-section-label">Repository</p>
            <NavLink
              to={`/groups/${project.orgSlug}`}
              className="app-sidebar-back"
              title={collapsed ? project.orgSlug : undefined}
            >
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
                  title={collapsed ? label : undefined}
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
        <AppVersion collapsed={collapsed} />
      </div>
    </aside>
  )
}
