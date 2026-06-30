import type { ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { paginationMeta } from '../lib/pagination'
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

type ControlCheckProps = React.InputHTMLAttributes<HTMLInputElement> & {
  type: 'checkbox' | 'radio'
  label?: ReactNode
  description?: ReactNode
  row?: boolean
}

function ControlCheck({ type, label, description, row, className, ...props }: ControlCheckProps) {
  return (
    <label className={cn('app-control-check', row && 'app-control-check--row', className)}>
      <input type={type} {...props} />
      {(label || description) && (
        <span className="app-control-check-content">
          {label && <span className="app-control-check-label">{label}</span>}
          {description && <span className="app-control-check-desc">{description}</span>}
        </span>
      )}
    </label>
  )
}

export function Checkbox({
  label,
  description,
  row,
  className,
  ...props
}: Omit<ControlCheckProps, 'type'>) {
  return (
    <ControlCheck type="checkbox" label={label} description={description} row={row} className={className} {...props} />
  )
}

export function Radio({
  label,
  description,
  row,
  className,
  ...props
}: Omit<ControlCheckProps, 'type'>) {
  return (
    <ControlCheck type="radio" label={label} description={description} row={row} className={className} {...props} />
  )
}

export function RadioGroup({
  label,
  hint,
  row,
  className,
  children,
}: {
  label?: ReactNode
  hint?: ReactNode
  row?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <fieldset className={cn('app-control-field border-0 p-0 m-0', className)}>
      {label && <legend className="app-control-field-label mb-1">{label}</legend>}
      {hint && <p className="app-control-field-hint mb-2">{hint}</p>}
      <div className={cn('app-control-radio-group', row && 'app-control-radio-group--row')}>
        {children}
      </div>
    </fieldset>
  )
}

export function Select({
  label,
  hint,
  className,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & {
  label?: ReactNode
  hint?: ReactNode
}) {
  const select = (
    <select className={cn('app-field app-select', className)} {...props}>
      {children}
    </select>
  )

  if (!label && !hint) {
    return select
  }

  return (
    <label className="app-control-field">
      {label && <span className="app-control-field-label">{label}</span>}
      {select}
      {hint && <span className="app-control-field-hint">{hint}</span>}
    </label>
  )
}

export { RefSelect } from './RefSelect'

export function TablePagination({
  page,
  pageSize,
  total,
  onPageChange,
  className,
  itemLabel = 'items',
}: {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
  className?: string
  itemLabel?: string
}) {
  const { totalPages, currentPage, rangeStart, rangeEnd } = paginationMeta(total, page, pageSize)

  if (total === 0) {
    return null
  }

  return (
    <div className={cn('app-table-pagination', className)}>
      <p className="text-sm text-text-secondary m-0">
        Showing {rangeStart}–{rangeEnd} of {total} {itemLabel}
      </p>
      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="app-table-page-btn"
            data-no-global-button-hover="true"
            disabled={currentPage <= 1}
            onClick={() => onPageChange(currentPage - 1)}
            aria-label="Previous page"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="px-2 text-sm text-text-secondary tabular-nums">
            {currentPage} / {totalPages}
          </span>
          <button
            type="button"
            className="app-table-page-btn"
            data-no-global-button-hover="true"
            disabled={currentPage >= totalPages}
            onClick={() => onPageChange(currentPage + 1)}
            aria-label="Next page"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  )
}
