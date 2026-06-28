import type { LucideIcon } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  Settings,
  Shield,
  Users,
  Workflow,
} from 'lucide-react'
import {
  REPO_SETTINGS_SECTIONS,
  type RepoSettingsSection,
  parseRepoSettingsSection,
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
}

export function RepoSettingsNav({ basePath }: RepoSettingsNavProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const activeSection = parseRepoSettingsSection(
    new URLSearchParams(location.search).get('section'),
  )

  return (
    <nav className="app-segment-bar repo-settings-tabs" aria-label="Repository settings">
      <div className="app-segment" role="tablist">
        {REPO_SETTINGS_SECTIONS.map(({ id, label }) => {
          const Icon = SECTION_ICONS[id]
          const isActive = activeSection === id
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={cn('app-segment-tab', isActive && 'active')}
              onClick={() => navigate(repoSettingsSectionHref(basePath, id))}
            >
              <Icon size={15} aria-hidden />
              {label}
            </button>
          )
        })}
      </div>
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
