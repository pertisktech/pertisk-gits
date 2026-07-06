import { ChevronDown, Download } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { SecondaryButton } from './ui'
import { cn } from '../utils/cn'

interface ImportMenuDropdownProps {
  basePath?: string
  className?: string
}

export function ImportMenuDropdown({ basePath = '/groups', className }: ImportMenuDropdownProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    function onEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    document.addEventListener('keydown', onEscape)
    return () => {
      document.removeEventListener('mousedown', onClickOutside)
      document.removeEventListener('keydown', onEscape)
    }
  }, [open])

  return (
    <div className={cn('relative', className)} ref={ref}>
      <SecondaryButton
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((value) => !value)}
      >
        <Download size={14} />
        Import
        <ChevronDown size={14} className={cn('transition-transform', open && 'rotate-180')} />
      </SecondaryButton>

      {open && (
        <div className="app-action-menu" role="menu" aria-label="Import">
          <div className="app-action-menu-heading">Import</div>
          <Link
            to={`${basePath}/import?provider=github`}
            className="app-action-menu-item"
            role="menuitem"
            onClick={() => setOpen(false)}
          >
            Import GitHub
          </Link>
          <Link
            to={`${basePath}/import?provider=gitlab`}
            className="app-action-menu-item"
            role="menuitem"
            onClick={() => setOpen(false)}
          >
            Import GitLab
          </Link>
          <Link
            to={`${basePath}/import?provider=pertisk`}
            className="app-action-menu-item"
            role="menuitem"
            onClick={() => setOpen(false)}
          >
            Import Pertisk Gits
          </Link>
        </div>
      )}
    </div>
  )
}
