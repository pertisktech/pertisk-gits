import { AlertTriangle, Loader2, Trash2, X } from 'lucide-react'
import { useEffect } from 'react'
import type { CiSecret } from '../api/types'
import { PrimaryButton, SecondaryButton } from './ui'
import { SecretEnvBadge } from './SecretFormDialog'

export function SecretDeleteDialog({
  open,
  secret,
  pending,
  error,
  onClose,
  onConfirm,
}: {
  open: boolean
  secret: CiSecret | null
  pending?: boolean
  error?: string | null
  onClose: () => void
  onConfirm: () => void
}) {
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !pending) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, pending, onClose])

  if (!open || !secret) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="presentation"
      onClick={() => {
        if (!pending) onClose()
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="secret-delete-title"
        className="w-full max-w-md rounded-lg border border-naturals-n4 bg-surface shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-naturals-n4 px-5 py-4">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-dashboard-danger-bg text-dashboard-danger">
              <AlertTriangle size={18} />
            </span>
            <div>
              <h2 id="secret-delete-title" className="text-base font-semibold text-text">
                Delete secret?
              </h2>
              <p className="mt-1 text-sm text-text-secondary">
                Pipelines using this secret will fail until a replacement is added.
              </p>
            </div>
          </div>
          <button
            type="button"
            className="rounded-md p-1 text-text-secondary hover:bg-hover hover:text-text"
            aria-label="Close"
            disabled={pending}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div className="rounded-md border border-border bg-surface-elevated/50 px-3 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm font-medium text-text">{secret.name}</span>
              <SecretEnvBadge environment={secret.environment} />
            </div>
          </div>

          {error && <p className="text-sm text-dashboard-danger">{error}</p>}

          <div className="flex justify-end gap-2 border-t border-naturals-n4 pt-4">
            <SecondaryButton type="button" disabled={pending} onClick={onClose}>
              Cancel
            </SecondaryButton>
            <PrimaryButton
              type="button"
              className="bg-dashboard-danger hover:bg-dashboard-danger/90"
              disabled={pending}
              onClick={onConfirm}
            >
              {pending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Trash2 size={14} />
              )}
              {pending ? 'Deleting…' : 'Delete secret'}
            </PrimaryButton>
          </div>
        </div>
      </div>
    </div>
  )
}
