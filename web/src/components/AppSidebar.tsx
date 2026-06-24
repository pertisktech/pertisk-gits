import {
  ArrowLeft,
  Code2,
  CircleDot,
  GitCommit,
  GitPullRequest,
  LayoutDashboard,
  Server,
  Settings,
  Users,
  Workflow,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { useProjectNav } from '../hooks/useProjectNav'
import type { ProjectTab } from '../lib/projectRoute'
import { projectTabPath } from '../lib/projectRoute'
import { cn } from '../utils/cn'
import { AppVersion } from './AppVersion'

const globalNavItems: { to: string; label: string; icon: LucideIcon; end?: boolean }[] = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/groups', label: 'Repositories', icon: Users },
  { to: '/runners', label: 'Runners', icon: Server },
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

  return (
    <aside id="app-sidebar" className={cn('app-sidebar', open && 'open')} aria-label="Main navigation">
      <div className="app-sidebar-header">
        <NavLink to="/dashboard" className="app-brand">
          <img src="/favicon.svg" alt="" className="w-7 h-7" />
          <span>Pertisk Gits</span>
        </NavLink>
      </div>

      <nav className="app-sidebar-nav">
        {!project &&
          globalNavItems.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={globalLinkClass}>
              <Icon size={16} className="shrink-0" aria-hidden />
              <span>{label}</span>
            </NavLink>
          ))}

        {project && (
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
                  className={() => projectLinkClass(project.tab === id, false)}
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
