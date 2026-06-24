import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { cn } from '../utils/cn'

export interface Crumb {
  label: string
  to?: string
}

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav className="flex items-center gap-1.5 flex-wrap text-sm text-text-secondary mb-4" aria-label="Breadcrumb">
      {items.map((item, index) => (
        <span key={`${item.label}-${index}`} className="inline-flex items-center gap-1.5">
          {index > 0 && <span className="text-muted">/</span>}
          {item.to ? (
            <Link to={item.to} className="hover:text-text transition-colors">
              {item.label}
            </Link>
          ) : (
            <span className="text-text">{item.label}</span>
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
    <div className="flex items-start justify-between gap-4 flex-wrap mb-6 md:mb-7">
      <div>
        <h1 className="text-xl font-medium text-naturals-n14">{title}</h1>
        {subtitle && <p className="text-sm text-naturals-n13 mt-1">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

export function PrimaryButton({
  children,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex items-center gap-2 px-4 py-1.5 rounded-md bg-primary-p4 text-naturals-n14 text-sm font-medium hover:bg-primary-p3 disabled:opacity-60 transition-colors',
        className,
      )}
      data-no-global-button-hover="true"
      {...props}
    >
      {children}
    </button>
  )
}

export function SecondaryButton({
  children,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex items-center gap-2 px-4 py-1.5 rounded-md border border-naturals-n4 text-naturals-n13 hover:text-naturals-n14 hover:bg-naturals-n3 text-sm font-medium disabled:opacity-60 transition-colors',
        className,
      )}
      data-no-global-button-hover="true"
      {...props}
    >
      {children}
    </button>
  )
}

export function LinkButton({
  to,
  children,
  primary,
  className,
}: {
  to: string
  children: ReactNode
  primary?: boolean
  className?: string
}) {
  return (
    <Link
      to={to}
      className={cn(
        primary
          ? 'inline-flex items-center gap-2 px-4 py-1.5 rounded-md bg-primary-p4 text-naturals-n14 text-sm font-medium hover:bg-primary-p3 transition-colors'
          : 'inline-flex items-center gap-2 px-4 py-1.5 rounded-md border border-naturals-n4 text-naturals-n13 hover:text-naturals-n14 hover:bg-naturals-n3 text-sm font-medium transition-colors',
        className,
      )}
    >
      {children}
    </Link>
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
    <div className="text-center py-12 px-6">
      {icon && <div className="flex justify-center mb-3 text-muted opacity-50">{icon}</div>}
      <h3 className="text-naturals-n14 font-medium mb-2">{title}</h3>
      {description && <p className="text-text-secondary text-sm max-w-md mx-auto">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}
