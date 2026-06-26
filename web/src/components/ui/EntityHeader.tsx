import type { ReactNode } from 'react'
import { cn } from '../../utils/cn'

export function EntityHeader({
  title,
  description,
  meta,
  badge,
  actions,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  meta?: ReactNode
  badge?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('mb-6 flex flex-wrap items-start justify-between gap-4', className)}>
      <div className="min-w-0">
        <h1 className="flex flex-wrap items-center gap-2 text-title-sm font-semibold text-gray-800 dark:text-white/90">
          {title}
          {badge}
        </h1>
        {description && (
          <p className="mt-1 text-theme-sm text-gray-500 dark:text-gray-400">{description}</p>
        )}
        {meta && (
          <p className="mt-1 font-mono text-theme-xs text-gray-400 dark:text-gray-500">{meta}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
    </div>
  )
}
