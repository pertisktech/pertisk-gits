import type { LucideIcon } from 'lucide-react'
import { Settings, Workflow } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  GROUP_SETTINGS_SECTIONS,
  type GroupSettingsSection,
  parseGroupSettingsSection,
  groupSettingsSectionHref,
} from '../../lib/groupSettingsRoute'
import { cn } from '../../utils/cn'

const SECTION_ICONS: Record<GroupSettingsSection, LucideIcon> = {
  general: Settings,
  automation: Workflow,
}

interface GroupSettingsNavProps {
  basePath: string
}

export function GroupSettingsNav({ basePath }: GroupSettingsNavProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const activeSection = parseGroupSettingsSection(
    new URLSearchParams(location.search).get('section'),
  )

  return (
    <nav className="app-segment-bar repo-settings-tabs" aria-label="Group settings">
      <div className="app-segment" role="tablist">
        {GROUP_SETTINGS_SECTIONS.map(({ id, label }) => {
          const Icon = SECTION_ICONS[id]
          const isActive = activeSection === id
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={cn('app-segment-tab', isActive && 'active')}
              onClick={() => navigate(groupSettingsSectionHref(basePath, id))}
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

export const GROUP_SETTINGS_SECTION_META: Record<
  GroupSettingsSection,
  { title: string; description: string; icon: LucideIcon }
> = {
  general: {
    title: 'General',
    description: 'Group name, URL slug, and description.',
    icon: Settings,
  },
  automation: {
    title: 'Automation',
    description: 'CI secrets and variables shared by every project in this group.',
    icon: Workflow,
  },
}
