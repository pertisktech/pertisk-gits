import { AlertTriangle, Loader2, RefreshCw, Trash2, Upload, X } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import { cn } from '../utils/cn'
import { SecondaryButton } from './ui'

export function ConfirmModal({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  variant = 'default',
  loading = false,
  confirmDisabled = false,
  icon,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  description: ReactNode
  confirmLabel: string
  cancelLabel?: string
  variant?: 'default' | 'danger'
  loading?: boolean
  confirmDisabled?: boolean
  icon?: ReactNode
  onConfirm: () => void
  onCancel: () => void
}) {
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !loading) onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, loading, onCancel])

  if (!open) return null

  const defaultIcon =
    variant === 'danger' ? (
      <Trash2 size={18} className="text-dashboard-danger" />
    ) : (
      <RefreshCw size={18} className="text-dashboard-warning" />
    )

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="presentation"
      onClick={() => {
        if (!loading) onCancel()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        className="w-full max-w-md rounded-lg border border-naturals-n4 bg-surface shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-naturals-n4 px-5 py-4">
          <div className="flex items-start gap-3 min-w-0">
            <div
              className={cn(
                'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
                variant === 'danger'
                  ? 'bg-dashboard-danger-bg'
                  : 'bg-dashboard-warning-bg',
              )}
            >
              {icon ?? defaultIcon}
            </div>
            <div className="min-w-0">
              <h2 id="confirm-modal-title" className="text-base font-semibold text-text">
                {title}
              </h2>
              <div className="mt-1.5 text-sm text-text-secondary leading-relaxed">{description}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="shrink-0 rounded-md p-1 text-text-secondary hover:bg-hover hover:text-text disabled:opacity-50"
            aria-label="Close"
            data-no-global-button-hover="true"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex justify-end gap-2 px-5 py-4">
          <SecondaryButton type="button" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </SecondaryButton>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading || confirmDisabled}
            className={cn(
              'inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-60',
              variant === 'danger'
                ? 'bg-dashboard-danger text-white hover:opacity-90'
                : 'bg-primary text-on-primary hover:opacity-90',
            )}
            data-no-global-button-hover="true"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : null}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

export function RotateRunnerConfirm({
  runnerName,
  loading,
  onConfirm,
  onCancel,
}: {
  runnerName: string
  loading?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <ConfirmModal
      open
      title="Rotate runner token?"
      description={
        <>
          The current token for <strong className="text-text font-mono">{runnerName}</strong> will stop
          working immediately. Update <code className="text-xs">PERTISK_RUNNER_TOKEN</code> on the host
          and restart <code className="text-xs">pertisk-runner</code>.
        </>
      }
      confirmLabel="Rotate token"
      loading={loading}
      onConfirm={onConfirm}
      onCancel={onCancel}
      icon={<AlertTriangle size={18} className="text-dashboard-warning" />}
    />
  )
}

export function DeleteRunnerConfirm({
  runnerName,
  loading,
  onConfirm,
  onCancel,
}: {
  runnerName: string
  loading?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <ConfirmModal
      open
      variant="danger"
      title="Delete runner?"
      description={
        <>
          Remove <strong className="text-text font-mono">{runnerName}</strong> from the registry. The
          runner process on the host will no longer authenticate.
        </>
      }
      confirmLabel="Delete runner"
      loading={loading}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  )
}

export function RestoreBackupConfirm({
  fileName,
  components,
  loading,
  onConfirm,
  onCancel,
}: {
  fileName: string
  components: string
  loading?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <ConfirmModal
      open
      variant="danger"
      title="Restore backup?"
      description={
        <>
          This will overwrite <strong className="text-text">{components}</strong> on this instance
          using <strong className="text-text font-mono">{fileName}</strong>. This action cannot be
          undone.
        </>
      }
      confirmLabel="Restore"
      loading={loading}
      onConfirm={onConfirm}
      onCancel={onCancel}
      icon={<Upload size={18} className="text-dashboard-danger" />}
    />
  )
}

export function DeleteBackupConfirm({
  createdAt,
  components,
  loading,
  onConfirm,
  onCancel,
}: {
  createdAt: string
  components: string
  loading?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <ConfirmModal
      open
      variant="danger"
      title="Delete backup?"
      description={
        <>
          Permanently delete the backup from <strong className="text-text">{createdAt}</strong>
          {components ? (
            <>
              {' '}
              ({components})
            </>
          ) : null}
          . The archive file will be removed from disk.
        </>
      }
      confirmLabel="Delete backup"
      loading={loading}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  )
}
