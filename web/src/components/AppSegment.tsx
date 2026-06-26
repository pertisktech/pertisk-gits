import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '../utils/cn'

export interface AppTab {
  id: string
  label: string
  icon?: LucideIcon
}

export function ShellTabs({
  tabs,
  active,
  onChange,
  action,
  className,
}: {
  tabs: AppTab[]
  active: string
  onChange: (id: string) => void
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'mb-6 flex flex-wrap items-end justify-between gap-3 border-b border-gray-200 dark:border-gray-800',
        className,
      )}
    >
      <div className="flex flex-wrap" role="tablist">
        {tabs.map((tab) => {
          const Icon = tab.icon
          const isActive = active === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={cn(
                'inline-flex items-center gap-2 border-b-2 px-4 py-3 -mb-px text-theme-sm font-medium transition-colors',
                isActive
                  ? 'border-brand-500 text-brand-500'
                  : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300',
              )}
              onClick={() => onChange(tab.id)}
            >
              {Icon && <Icon size={16} />}
              {tab.label}
            </button>
          )
        })}
      </div>
      {action}
    </div>
  )
}

/** Compact inline tabs (e.g. open/closed filters on issues). */
export function ShellInlineTabs({
  tabs,
  active,
  onChange,
  className,
}: {
  tabs: { id: string; label: string }[]
  active: string
  onChange: (id: string) => void
  className?: string
}) {
  return (
    <div
      className={cn(
        'inline-flex rounded-lg border border-gray-200 bg-gray-100 p-0.5 dark:border-gray-800 dark:bg-gray-900',
        className,
      )}
      role="tablist"
    >
      {tabs.map((tab) => {
        const isActive = active === tab.id
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={cn(
              'rounded-md px-3 py-1.5 text-theme-xs font-medium transition-colors',
              isActive
                ? 'bg-white text-gray-800 shadow-theme-xs dark:bg-gray-dark dark:text-white/90'
                : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300',
            )}
            onClick={() => onChange(tab.id)}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}

// Backward-compatible alias
export const AppSegment = ShellTabs
