import type { ReactNode } from 'react'
import { Badge, type BadgeColor } from './ui/Badge'
import { cn } from '../utils/cn'

type Variant = 'green' | 'yellow' | 'red' | 'gray' | 'violet'

const variantColor: Record<Variant, BadgeColor> = {
  green: 'success',
  yellow: 'warning',
  red: 'error',
  gray: 'gray',
  violet: 'primary',
}

export function StatusBadge({
  variant,
  children,
  className,
}: {
  variant: Variant
  children: ReactNode
  className?: string
}) {
  return (
    <Badge variant="light" color={variantColor[variant]} className={cn('whitespace-nowrap', className)}>
      {children}
    </Badge>
  )
}

export function visibilityVariant(visibility: 'public' | 'private'): Variant {
  return visibility === 'public' ? 'green' : 'yellow'
}
