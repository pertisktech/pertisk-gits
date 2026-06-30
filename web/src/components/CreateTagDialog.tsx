import { Loader2, Tag, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { PrimaryButton, SecondaryButton, Select } from './ui'

export interface CreateTagParams {
  name: string
  targetRef: string
  message: string
}

export function CreateTagDialog({
  open,
  branches,
  defaultBranch,
  pending,
  error,
  onClose,
  onCreate,
}: {
  open: boolean
  branches: string[]
  defaultBranch: string
  pending?: boolean
  error?: string | null
  onClose: () => void
  onCreate: (params: CreateTagParams) => void
}) {
  const [name, setName] = useState('')
  const [targetRef, setTargetRef] = useState(defaultBranch)
  const [message, setMessage] = useState('')

  const branchList = branches.length > 0 ? branches : [defaultBranch]

  useEffect(() => {
    if (!open) return
    setName('')
    setMessage('')
    setTargetRef(
      branchList.includes(defaultBranch) ? defaultBranch : branchList[0] ?? defaultBranch,
    )
  }, [open, branchList, defaultBranch])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !pending) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, pending, onClose])

  useEffect(() => {
    if (!branchList.includes(targetRef)) {
      setTargetRef(branchList[0] ?? defaultBranch)
    }
  }, [branchList, targetRef, defaultBranch])

  const trimmedName = name.trim()
  const canCreate = Boolean(trimmedName) && Boolean(targetRef)

  if (!open) return null

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
        aria-labelledby="create-tag-title"
        className="w-full max-w-md rounded-lg border border-naturals-n4 bg-surface shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-naturals-n4 px-5 py-4">
          <div>
            <h2 id="create-tag-title" className="text-base font-semibold text-text">
              Create tag
            </h2>
            <p className="mt-1 text-sm text-text-secondary">
              Point a new tag at a branch tip or release commit.
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
            if (!canCreate || pending) return
            onCreate({
              name: trimmedName,
              targetRef,
              message: message.trim(),
            })
          }}
        >
          <div className="space-y-1">
            <label className="text-sm font-medium text-text" htmlFor="create-tag-name">
              Tag name
            </label>
            <input
              id="create-tag-name"
              className="app-field font-mono text-sm"
              value={name}
              disabled={pending}
              placeholder="v1.0.0"
              autoFocus
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          <Select
            id="create-tag-target"
            label="Create from"
            hint="Tags the current tip of the selected branch."
            className="font-mono text-sm"
            value={targetRef}
            disabled={pending || branchList.length === 0}
            onChange={(event) => setTargetRef(event.target.value)}
          >
            {branchList.map((branch) => (
              <option key={branch} value={branch}>
                {branch}
              </option>
            ))}
          </Select>

          <div className="space-y-1">
            <label className="text-sm font-medium text-text" htmlFor="create-tag-message">
              Message <span className="font-normal text-text-secondary">(optional)</span>
            </label>
            <textarea
              id="create-tag-message"
              className="app-field min-h-24 resize-y text-sm"
              value={message}
              disabled={pending}
              placeholder="Release notes or version summary"
              onChange={(event) => setMessage(event.target.value)}
            />
            <p className="text-xs text-text-secondary">
              Leave empty for a lightweight tag, or add a message to create an annotated tag.
            </p>
          </div>

          {error && (
            <p className="text-sm text-dashboard-danger">{error}</p>
          )}

          <div className="flex justify-end gap-2 border-t border-naturals-n4 pt-4">
            <SecondaryButton type="button" disabled={pending} onClick={onClose}>
              Cancel
            </SecondaryButton>
            <PrimaryButton type="submit" disabled={pending || !canCreate}>
              {pending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Tag size={14} />
              )}
              Create tag
            </PrimaryButton>
          </div>
        </form>
      </div>
    </div>
  )
}
