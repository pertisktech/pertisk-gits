import { Loader2, Pencil, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { TagInfo } from '../api/types'
import { PrimaryButton, SecondaryButton, Select } from './ui'

export interface EditTagParams {
  name: string
  targetRef?: string
  message: string
}

export function EditTagDialog({
  open,
  tag,
  branches,
  defaultBranch,
  pending,
  error,
  onClose,
  onSave,
}: {
  open: boolean
  tag: TagInfo | null
  branches: string[]
  defaultBranch: string
  pending?: boolean
  error?: string | null
  onClose: () => void
  onSave: (params: EditTagParams) => void
}) {
  const [name, setName] = useState('')
  const [targetRef, setTargetRef] = useState('')
  const [message, setMessage] = useState('')

  const branchList = branches.length > 0 ? branches : [defaultBranch]

  useEffect(() => {
    if (!open || !tag) return
    setName(tag.name)
    setMessage(tag.message ?? '')
    setTargetRef('')
  }, [open, tag])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !pending) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, pending, onClose])

  if (!open || !tag) return null

  const trimmedName = name.trim()
  const nameChanged = trimmedName !== tag.name
  const messageChanged = message.trim() !== (tag.message ?? '').trim()
  const targetChanged = Boolean(targetRef)
  const canSave =
    Boolean(trimmedName) &&
    (nameChanged || messageChanged || targetChanged)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="presentation"
      onClick={() => {
        if (!pending) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-tag-title"
        className="w-full max-w-md rounded-lg border border-naturals-n4 bg-surface shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-naturals-n4 px-5 py-4">
          <div>
            <h2 id="edit-tag-title" className="text-base font-semibold text-text">
              Edit tag
            </h2>
            <p className="mt-1 text-sm text-text-secondary">
              Rename the tag, move it to another commit, or update its message.
            </p>
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

        <form
          className="space-y-4 px-5 py-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (!canSave || pending) return
            onSave({
              name: trimmedName,
              targetRef: targetRef || undefined,
              message: message.trim(),
            })
          }}
        >
          <div className="space-y-1">
            <label className="text-sm font-medium text-text" htmlFor="edit-tag-name">
              Tag name
            </label>
            <input
              id="edit-tag-name"
              className="app-field font-mono text-sm"
              value={name}
              disabled={pending}
              autoFocus
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          <p className="text-xs text-text-secondary font-mono">
            Current commit: {tag.short_sha}
          </p>

          <Select
            id="edit-tag-target"
            label="Move to branch tip"
            hint="Leave unchanged to keep the tag on its current commit."
            className="font-mono text-sm"
            value={targetRef}
            disabled={pending || branchList.length === 0}
            onChange={(event) => setTargetRef(event.target.value)}
          >
            <option value="">Keep current commit</option>
            {branchList.map((branch) => (
              <option key={branch} value={branch}>
                {branch}
              </option>
            ))}
          </Select>

          <div className="space-y-1">
            <label className="text-sm font-medium text-text" htmlFor="edit-tag-message">
              Message <span className="font-normal text-text-secondary">(optional)</span>
            </label>
            <textarea
              id="edit-tag-message"
              className="app-field min-h-24 resize-y text-sm"
              value={message}
              disabled={pending}
              placeholder="Release notes or version summary"
              onChange={(event) => setMessage(event.target.value)}
            />
          </div>

          {error && (
            <p className="text-sm text-dashboard-danger">{error}</p>
          )}

          <div className="flex justify-end gap-2 border-t border-naturals-n4 pt-4">
            <SecondaryButton type="button" disabled={pending} onClick={onClose}>
              Cancel
            </SecondaryButton>
            <PrimaryButton type="submit" disabled={pending || !canSave}>
              {pending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Pencil size={14} />
              )}
              Save changes
            </PrimaryButton>
          </div>
        </form>
      </div>
    </div>
  )
}
