import { cn } from '../utils/cn'

type Variant = 'green' | 'yellow' | 'red' | 'gray' | 'violet'

const variantClass: Record<Variant, string> = {
  green: 'status-green',
  yellow: 'status-yellow',
  red: 'status-red',
  gray: 'status-gray',
  violet: 'resource-label label-violet',
}

export function StatusBadge({
  variant,
  children,
  className,
}: {
  variant: Variant
  children: React.ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap px-2.5 py-0.5 rounded-full text-xs font-medium',
        variantClass[variant],
        className,
      )}
    >
      {children}
    </span>
  )
}

export function visibilityVariant(visibility: 'public' | 'private'): Variant {
  return visibility === 'public' ? 'green' : 'yellow'
}
