import type { ReactNode } from 'react'
import { cn } from '../../utils/cn'

export function MetricCard({
  label,
  value,
  icon,
  className,
}: {
  label: string
  value: string | number
  icon: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] md:p-6',
        className,
      )}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gray-100 dark:bg-gray-800 text-brand-500">
        {icon}
      </div>
      <div className="mt-5">
        <span className="text-sm text-gray-500 dark:text-gray-400">{label}</span>
        <h4 className="mt-2 text-2xl font-bold text-gray-800 dark:text-white/90 tabular-nums">
          {value}
        </h4>
      </div>
    </div>
  )
}
