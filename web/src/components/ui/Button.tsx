import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { cn } from '../../utils/cn'

export type ButtonVariant = 'primary' | 'outline' | 'ghost'
export type ButtonSize = 'sm' | 'md'

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'bg-brand-500 text-white shadow-theme-xs hover:bg-brand-600 disabled:bg-brand-300 dark:disabled:bg-brand-500/40',
  outline:
    'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-dark dark:text-gray-300 dark:hover:bg-white/5',
  ghost:
    'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/5',
}

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'px-3.5 py-2 text-theme-xs gap-1.5',
  md: 'px-4 py-2.5 text-theme-sm gap-2',
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  startIcon?: ReactNode
  endIcon?: ReactNode
}

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  children,
  startIcon,
  endIcon,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center justify-center font-medium rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-60',
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      data-no-global-button-hover="true"
      {...props}
    >
      {startIcon}
      {children}
      {endIcon}
    </button>
  )
}

export function LinkButton({
  to,
  children,
  variant = 'outline',
  size = 'md',
  className,
  startIcon,
  endIcon,
}: {
  to: string
  children: ReactNode
  variant?: ButtonVariant
  size?: ButtonSize
  className?: string
  startIcon?: ReactNode
  endIcon?: ReactNode
}) {
  return (
    <Link
      to={to}
      className={cn(
        'inline-flex items-center justify-center font-medium rounded-lg transition-colors',
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
    >
      {startIcon}
      {children}
      {endIcon}
    </Link>
  )
}
