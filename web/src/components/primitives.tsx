import type { ReactNode } from 'react'
import { cn } from '../utils/cn'

export function Badge({
  children,
  variant = 'muted',
  className,
}: {
  children: ReactNode
  variant?: 'muted' | 'primary' | 'success' | 'warning' | 'outline'
  className?: string
}) {
  return <span className={cn('pg-badge', `pg-badge--${variant}`, className)}>{children}</span>
}

export function Avatar({ name, className }: { name: string; className?: string }) {
  const initials = name
    .split(/[\s-_@.]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('')
  return (
    <span className={cn('pg-avatar', className)} aria-hidden="true">
      {initials || '?'}
    </span>
  )
}

export function RepoIcon({ name, className }: { name: string; className?: string }) {
  return (
    <span className={cn('pg-repo-icon', className)} aria-hidden="true">
      {name[0]?.toUpperCase() || '?'}
    </span>
  )
}
