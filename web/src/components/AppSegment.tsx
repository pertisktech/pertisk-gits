import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '../utils/cn'

export interface AppTab {
  id: string
  label: string
  icon?: LucideIcon
}

export function AppSegment({
  tabs,
  active,
  onChange,
  action,
  actionAlign = 'end',
}: {
  tabs: AppTab[]
  active: string
  onChange: (id: string) => void
  action?: ReactNode
  /** `fill` grows action from the tabs to the right edge; `end` pins it to the right. */
  actionAlign?: 'fill' | 'end'
}) {
  return (
    <div className="app-segment-bar">
      <div className="app-segment" role="tablist">
        {tabs.map((tab) => {
          const Icon = tab.icon
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active === tab.id}
              className={cn('app-segment-tab', active === tab.id && 'active')}
              onClick={() => onChange(tab.id)}
            >
              {Icon && <Icon size={15} />}
              {tab.label}
            </button>
          )
        })}
      </div>
      {action ? (
        <div
          className={cn(
            'app-segment-bar-action',
            actionAlign === 'end' && 'app-segment-bar-action--end',
            actionAlign === 'fill' && 'app-segment-bar-action--fill',
          )}
        >
          {action}
        </div>
      ) : null}
    </div>
  )
}
