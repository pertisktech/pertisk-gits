import type { ReactNode } from 'react'
import { cn } from '../utils/cn'

export function Card({
  title,
  children,
  className,
  action,
}: {
  title?: string
  children: ReactNode
  className?: string
  action?: ReactNode
}) {
  return (
    <div className={cn('bg-surface border border-border rounded-lg overflow-hidden', className)}>
      {title && (
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold text-text">{title}</h2>
          {action}
        </div>
      )}
      <div className="p-6">{children}</div>
    </div>
  )
}

export function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-surface border border-border rounded-lg p-5">
      <div className="text-2xl font-bold text-primary">{value}</div>
      <div className="text-sm text-text-secondary mt-1">{label}</div>
    </div>
  )
}
