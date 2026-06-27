import {
  Settings,
  Shield,
  Users,
  Workflow,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import {
  REPO_SETTINGS_SECTIONS,
  type RepoSettingsSection,
  repoSettingsSectionHref,
} from '../../lib/repoSettingsRoute'
import { cn } from '../../utils/cn'

const SECTION_ICONS: Record<RepoSettingsSection, LucideIcon> = {
  general: Settings,
  access: Users,
  security: Shield,
  automation: Workflow,
}

interface RepoSettingsNavProps {
  basePath: string
  activeSection: RepoSettingsSection
}

export function RepoSettingsNav({ basePath, activeSection }: RepoSettingsNavProps) {
  return (
    <nav className="repo-settings-nav" aria-label="Repository settings">
      <span className="repo-settings-nav-label">Settings</span>
      {REPO_SETTINGS_SECTIONS.map(({ id, label }) => {
        const Icon = SECTION_ICONS[id]
        return (
          <NavLink
            key={id}
            to={repoSettingsSectionHref(basePath, id)}
            className={({ isActive }) =>
              cn('repo-settings-nav-link', (isActive || activeSection === id) && 'active')
            }
            end={false}
          >
            <Icon size={15} aria-hidden />
            {label}
          </NavLink>
        )
      })}
    </nav>
  )
}

export const REPO_SETTINGS_SECTION_META: Record<
  RepoSettingsSection,
  { title: string; description: string; icon: LucideIcon }
> = {
  general: {
    title: 'General',
    description: 'Repository name, visibility, and default branch.',
    icon: Settings,
  },
  access: {
    title: 'Access',
    description: 'Manage who can read, write, and administer this repository.',
    icon: Users,
  },
  security: {
    title: 'Security',
    description: 'Branch protection rules and SSH deploy keys.',
    icon: Shield,
  },
  automation: {
    title: 'Automation',
    description: 'CI secrets and GitOps webhook integrations.',
    icon: Workflow,
  },
}
