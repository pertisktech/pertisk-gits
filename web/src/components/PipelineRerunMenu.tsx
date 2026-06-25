import { ChevronDown, Loader2, RefreshCw } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { RerunScope } from '../lib/pipelineStatus'
import { cn } from '../utils/cn'
import { PrimaryButton } from './ui'

export function PipelineRerunMenu({
  disabled,
  loading,
  canRerunFailed,
  failedCount = 0,
  onRerun,
  compact,
}: {
  disabled?: boolean
  loading?: boolean
  canRerunFailed: boolean
  failedCount?: number
  onRerun: (scope: RerunScope) => void
  compact?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({})
  const ref = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const updateMenuPosition = () => {
    const el = ref.current
    if (!el) return

    const rect = el.getBoundingClientRect()
    const menuWidth = menuRef.current?.offsetWidth ?? 200
    const menuHeight = menuRef.current?.offsetHeight ?? 88
    const gap = 6
    const pad = 8

    let left = rect.right - menuWidth
    left = Math.max(pad, Math.min(left, window.innerWidth - menuWidth - pad))

    const spaceBelow = window.innerHeight - rect.bottom - gap - pad
    const spaceAbove = rect.top - gap - pad
    const fitsBelow = menuHeight <= spaceBelow
    const fitsAbove = menuHeight <= spaceAbove

    let top: number
    let maxHeight: number | undefined

    if (fitsBelow || (!fitsAbove && spaceBelow >= spaceAbove)) {
      top = rect.bottom + gap
      if (!fitsBelow) {
        maxHeight = Math.max(64, spaceBelow)
      }
    } else {
      maxHeight = Math.max(64, spaceAbove)
      top = rect.top - Math.min(menuHeight, maxHeight) - gap
      top = Math.max(pad, top)
    }

    setMenuStyle({
      top,
      left,
      minWidth: menuWidth,
      ...(maxHeight !== undefined ? { maxHeight, overflowY: 'auto' as const } : {}),
    })
  }

  useLayoutEffect(() => {
    if (!open) return
    updateMenuPosition()
    const raf = requestAnimationFrame(updateMenuPosition)
    window.addEventListener('resize', updateMenuPosition)
    window.addEventListener('scroll', updateMenuPosition, true)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', updateMenuPosition)
      window.removeEventListener('scroll', updateMenuPosition, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (ref.current?.contains(target)) return
      const portal = document.getElementById('pipeline-rerun-dropdown-portal')
      if (portal?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  const busy = Boolean(disabled || loading)

  const dropdown = open
    ? createPortal(
        <div
          id="pipeline-rerun-dropdown-portal"
          ref={menuRef}
          className="pipeline-rerun-dropdown"
          style={menuStyle}
          role="menu"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="pipeline-rerun-dropdown-item"
            role="menuitem"
            onClick={() => {
              onRerun('all')
              setOpen(false)
            }}
          >
            Re-run all jobs
          </button>
          <button
            type="button"
            className="pipeline-rerun-dropdown-item"
            role="menuitem"
            disabled={!canRerunFailed}
            title={
              canRerunFailed
                ? undefined
                : 'No failed or cancelled jobs in this run'
            }
            onClick={() => {
              onRerun('failed')
              setOpen(false)
            }}
          >
            Re-run failed only
            {failedCount > 0 && (
              <span className="pipeline-rerun-dropdown-meta">{failedCount}</span>
            )}
          </button>
        </div>,
        document.body,
      )
    : null

  return (
    <>
      <div
        className={cn('pipeline-rerun-menu', compact && 'pipeline-rerun-menu--compact')}
        ref={ref}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="pipeline-rerun-split">
          <PrimaryButton
            type="button"
            className={cn('pipeline-rerun-main', compact && 'pipeline-rerun-main--compact')}
            disabled={busy}
            aria-label={compact ? 'Re-run all jobs' : undefined}
            onClick={() => onRerun('all')}
          >
            {loading ? (
              <Loader2 size={compact ? 12 : 14} className="animate-spin shrink-0" />
            ) : (
              <RefreshCw size={compact ? 12 : 14} className="shrink-0" />
            )}
            {!compact && 'Re-run all'}
          </PrimaryButton>
          <button
            type="button"
            className="pipeline-rerun-toggle"
            disabled={busy}
            aria-label="More re-run options"
            aria-expanded={open}
            aria-haspopup="menu"
            onClick={() => {
              setOpen((value) => !value)
            }}
          >
            <ChevronDown size={compact ? 12 : 14} className={cn(open && 'rotate-180')} />
          </button>
        </div>
      </div>
      {dropdown}
    </>
  )
}
