import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '../../utils/cn'

interface SettingsPanelProps {
  title: string
  description?: string
  icon?: LucideIcon
  children: ReactNode
  footer?: ReactNode
  className?: string
}

export function SettingsPanel({
  title,
  description,
  icon: Icon,
  children,
  footer,
  className,
}: SettingsPanelProps) {
  return (
    <section className={cn('repo-settings-panel', className)}>
      <header className="repo-settings-panel-header">
        <div className="flex items-start gap-2.5">
          {Icon && (
            <span className="repo-settings-panel-icon" aria-hidden>
              <Icon size={16} />
            </span>
          )}
          <div className="min-w-0">
            <h2 className="repo-settings-panel-title">{title}</h2>
            {description && <p className="repo-settings-panel-desc">{description}</p>}
          </div>
        </div>
      </header>
      <div className="repo-settings-panel-body">{children}</div>
      {footer && <footer className="repo-settings-panel-footer">{footer}</footer>}
    </section>
  )
}

interface SettingsSubsectionProps {
  title: string
  description?: string
  children: ReactNode
  bordered?: boolean
}

export function SettingsSubsection({
  title,
  description,
  children,
  bordered = true,
}: SettingsSubsectionProps) {
  return (
    <div className={cn('repo-settings-subsection', bordered && 'repo-settings-subsection-bordered')}>
      <div className="repo-settings-subsection-header">
        <h3 className="repo-settings-subsection-title">{title}</h3>
        {description && <p className="repo-settings-subsection-desc">{description}</p>}
      </div>
      {children}
    </div>
  )
}
