import { FolderGit2, Package, ScrollText, Users } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import type { GroupTab } from '../lib/groupRoute'
import { groupTabPath } from '../lib/groupRoute'
import { cn } from '../utils/cn'

const groupNavItems: { id: GroupTab; label: string; icon: LucideIcon }[] = [
  { id: 'repositories', label: 'Repositories', icon: FolderGit2 },
  { id: 'registry', label: 'Registry', icon: Package },
  { id: 'members', label: 'Members', icon: Users },
  { id: 'audit', label: 'Audit log', icon: ScrollText },
]

export function GroupSubnav({ orgSlug, activeTab }: { orgSlug: string; activeTab: GroupTab }) {
  const basePath = `/groups/${orgSlug}`

  return (
    <nav className="app-group-nav" aria-label="Group navigation">
      {groupNavItems.map(({ id, label, icon: Icon }) => (
        <NavLink
          key={id}
          to={groupTabPath(basePath, id)}
          end={id === 'repositories'}
          className={({ isActive }) =>
            cn('app-group-nav-link', (isActive || activeTab === id) && 'active')
          }
        >
          <Icon size={15} aria-hidden />
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  )
}

export { groupNavItems }
