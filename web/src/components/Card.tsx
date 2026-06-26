import type { ReactNode } from 'react'
import { cn } from '../utils/cn'

export function Card({
  title,
  children,
  className,
  action,
}: {
  title?: ReactNode
  children: ReactNode
  className?: string
  action?: ReactNode
}) {
  return (
    <div className={cn('shell-card', className)}>
      {title && (
        <div className="shell-card-header">
          <h2 className="text-theme-sm font-semibold text-gray-800 dark:text-white/90">{title}</h2>
          {action}
        </div>
      )}
      <div className="shell-card-body">{children}</div>
    </div>
  )
}

export function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] md:p-6">
      <div className="text-2xl font-bold tabular-nums text-brand-500">{value}</div>
      <div className="mt-1 text-theme-sm text-gray-500 dark:text-gray-400">{label}</div>
    </div>
  )
}
