import { GitBranch, Loader2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { PrimaryButton, SecondaryButton, Select } from './ui'

export interface CreateBranchParams {
  name: string
  sourceRef: string
}

export function CreateBranchDialog({
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
  onCreate: (params: CreateBranchParams) => void
}) {
  const [name, setName] = useState('')
  const [sourceRef, setSourceRef] = useState(defaultBranch)

  const branchList = branches.length > 0 ? branches : [defaultBranch]

  useEffect(() => {
    if (!open) return
    setName('')
    setSourceRef(
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
    if (!branchList.includes(sourceRef)) {
      setSourceRef(branchList[0] ?? defaultBranch)
    }
  }, [branchList, sourceRef, defaultBranch])

  const trimmedName = name.trim()
  const canCreate = Boolean(trimmedName) && Boolean(sourceRef)

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
        aria-labelledby="create-branch-title"
        className="w-full max-w-md rounded-lg border border-naturals-n4 bg-surface shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-naturals-n4 px-5 py-4">
          <div>
            <h2 id="create-branch-title" className="text-base font-semibold text-text">
              Create branch
            </h2>
            <p className="mt-1 text-sm text-text-secondary">
              Create a new branch from an existing branch tip.
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
              sourceRef,
            })
          }}
        >
          <div className="space-y-1">
            <label className="text-sm font-medium text-text" htmlFor="create-branch-name">
              Branch name
            </label>
            <input
              id="create-branch-name"
              className="app-field font-mono text-sm"
              value={name}
              disabled={pending}
              placeholder="feature/my-change"
              autoFocus
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          <Select
            id="create-branch-source"
            label="Create from"
            className="font-mono text-sm"
            value={sourceRef}
            disabled={pending || branchList.length === 0}
            onChange={(event) => setSourceRef(event.target.value)}
          >
            {branchList.map((branch) => (
              <option key={branch} value={branch}>
                {branch}
              </option>
            ))}
          </Select>

          {error && <p className="text-sm text-dashboard-danger">{error}</p>}

          <div className="flex justify-end gap-2 border-t border-naturals-n4 pt-4">
            <SecondaryButton type="button" disabled={pending} onClick={onClose}>
              Cancel
            </SecondaryButton>
            <PrimaryButton type="submit" disabled={pending || !canCreate}>
              {pending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <GitBranch size={14} />
              )}
              Create branch
            </PrimaryButton>
          </div>
        </form>
      </div>
    </div>
  )
}
