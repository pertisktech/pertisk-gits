import type { LucideIcon } from 'lucide-react'
import { cn } from '../utils/cn'

export interface GogsTab {
  id: string
  label: string
  icon?: LucideIcon
}

export function GogsSegment({
  tabs,
  active,
  onChange,
}: {
  tabs: GogsTab[]
  active: string
  onChange: (id: string) => void
}) {
  return (
    <div className="gogs-segment" role="tablist">
      {tabs.map((tab) => {
        const Icon = tab.icon
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active === tab.id}
            className={cn('gogs-segment-tab', active === tab.id && 'active')}
            onClick={() => onChange(tab.id)}
          >
            {Icon && <Icon size={15} />}
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
