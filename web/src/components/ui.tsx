import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { cn } from '../utils/cn'
import { Button, LinkButton as ShellLinkButton } from './ui/Button'

export interface Crumb {
  label: string
  to?: string
}

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav
      className="mb-4 flex flex-wrap items-center gap-1.5 text-theme-sm text-gray-500 dark:text-gray-400"
      aria-label="Breadcrumb"
    >
      {items.map((item, index) => (
        <span key={`${item.label}-${index}`} className="inline-flex items-center gap-1.5">
          {index > 0 && <span className="text-gray-300 dark:text-gray-600">/</span>}
          {item.to ? (
            <Link to={item.to} className="hover:text-gray-800 dark:hover:text-white/90 transition-colors">
              {item.label}
            </Link>
          ) : (
            <span className="text-gray-800 dark:text-white/90">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  )
}

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string
  subtitle?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4 md:mb-7">
      <div>
        <h1 className="shell-page-title">{title}</h1>
        {subtitle && <p className="shell-page-subtitle">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

export function PrimaryButton({
  children,
  className,
  startIcon,
  endIcon,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  startIcon?: ReactNode
  endIcon?: ReactNode
}) {
  return (
    <Button variant="primary" size="md" className={className} startIcon={startIcon} endIcon={endIcon} {...props}>
      {children}
    </Button>
  )
}

export function SecondaryButton({
  children,
  className,
  startIcon,
  endIcon,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  startIcon?: ReactNode
  endIcon?: ReactNode
}) {
  return (
    <Button variant="outline" size="md" className={className} startIcon={startIcon} endIcon={endIcon} {...props}>
      {children}
    </Button>
  )
}

export function LinkButton({
  to,
  children,
  primary,
  className,
  startIcon,
  endIcon,
}: {
  to: string
  children: ReactNode
  primary?: boolean
  className?: string
  startIcon?: ReactNode
  endIcon?: ReactNode
}) {
  return (
    <ShellLinkButton
      to={to}
      variant={primary ? 'primary' : 'outline'}
      className={className}
      startIcon={startIcon}
      endIcon={endIcon}
    >
      {children}
    </ShellLinkButton>
  )
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="px-6 py-12 text-center">
      {icon && (
        <div className="mb-3 flex justify-center text-gray-400 dark:text-gray-500">{icon}</div>
      )}
      <h3 className="font-medium text-gray-800 dark:text-white/90">{title}</h3>
      {description && (
        <p className="mx-auto mt-2 max-w-md text-theme-sm text-gray-500 dark:text-gray-400">
          {description}
        </p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export function Alert({
  children,
  variant = 'error',
  className,
}: {
  children: ReactNode
  variant?: 'error' | 'warning' | 'info'
  className?: string
}) {
  const styles = {
    error: 'border-error-500/30 bg-error-50 text-error-600 dark:bg-error-500/10 dark:text-error-500',
    warning:
      'border-warning-500/30 bg-warning-50 text-warning-600 dark:bg-warning-500/10 dark:text-warning-500',
    info: 'border-brand-500/30 bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-400',
  }
  return (
    <div className={cn('rounded-lg border px-4 py-3 text-theme-sm', styles[variant], className)}>
      {children}
    </div>
  )
}
