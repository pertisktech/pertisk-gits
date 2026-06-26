import type { ReactNode } from 'react'
import { cn } from '../../utils/cn'

export type BadgeVariant = 'light' | 'solid'
export type BadgeColor = 'primary' | 'success' | 'error' | 'warning' | 'info' | 'gray'

const lightColors: Record<BadgeColor, string> = {
  primary: 'bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-400',
  success: 'bg-success-50 text-success-600 dark:bg-success-500/15 dark:text-success-500',
  error: 'bg-error-50 text-error-600 dark:bg-error-500/15 dark:text-error-500',
  warning: 'bg-warning-50 text-warning-600 dark:bg-warning-500/15 dark:text-warning-500',
  info: 'bg-sky-50 text-sky-600 dark:bg-sky-500/15 dark:text-sky-400',
  gray: 'bg-gray-100 text-gray-700 dark:bg-white/5 dark:text-gray-300',
}

const solidColors: Record<BadgeColor, string> = {
  primary: 'bg-brand-500 text-white',
  success: 'bg-success-500 text-white',
  error: 'bg-error-500 text-white',
  warning: 'bg-warning-500 text-white',
  info: 'bg-sky-500 text-white',
  gray: 'bg-gray-500 text-white dark:bg-gray-600',
}

export function Badge({
  children,
  variant = 'light',
  color = 'primary',
  className,
  startIcon,
}: {
  children: ReactNode
  variant?: BadgeVariant
  color?: BadgeColor
  className?: string
  startIcon?: ReactNode
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center gap-1 rounded-full px-2.5 py-0.5 font-medium text-theme-xs',
        variant === 'light' ? lightColors[color] : solidColors[color],
        className,
      )}
    >
      {startIcon}
      {children}
    </span>
  )
}
