import { FilePlus, FolderPlus, Loader2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  folderGitkeepPath,
  joinRepoPath,
  repoPathPreview,
  validateRepoPathSegment,
} from '../lib/repoPath'
import { PrimaryButton, SecondaryButton } from './ui'

export type RepoEntryKind = 'file' | 'folder'

export function CreateRepoEntryDialog({
  open,
  kind,
  basePath,
  pending,
  error,
  onClose,
  onCreate,
}: {
  open: boolean
  kind: RepoEntryKind
  basePath: string
  pending?: boolean
  error?: string | null
  onClose: () => void
  onCreate: (fullPath: string) => void
}) {
  const [name, setName] = useState('')
  const trimmedName = name.trim()
  const validationError = trimmedName
    ? validateRepoPathSegment(trimmedName, { allowDotPrefix: kind === 'file' })
    : null
  const previewPath =
    kind === 'folder'
      ? folderGitkeepPath(joinRepoPath(basePath, trimmedName))
      : repoPathPreview(basePath, trimmedName)
  const canCreate = Boolean(trimmedName) && !validationError

  useEffect(() => {
    if (!open) return
    setName('')
  }, [open, kind])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !pending) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, pending, onClose])

  if (!open) return null

  const title = kind === 'file' ? 'Create new file' : 'Create new folder'
  const Icon = kind === 'file' ? FilePlus : FolderPlus
  const placeholder =
    kind === 'file'
      ? basePath
        ? 'filename.ext or nested/path/file.ext'
        : 'README.md or src/main.rs'
      : basePath
        ? 'folder-name or nested/path'
        : 'docs or src/components'

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
        aria-labelledby="create-repo-entry-title"
        className="w-full max-w-md rounded-lg border border-naturals-n4 bg-surface shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-naturals-n4 px-5 py-4">
          <div>
            <h2 id="create-repo-entry-title" className="text-base font-semibold text-text flex items-center gap-2">
              <Icon size={18} className="text-primary" aria-hidden />
              {title}
            </h2>
            <p className="mt-1 text-sm text-text-secondary">
              {basePath ? (
                <>
                  In <span className="font-mono text-text">/{basePath}</span> on the current branch
                </>
              ) : (
                'At the repository root on the current branch'
              )}
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
            onCreate(previewPath)
          }}
        >
          <label className="block">
            <span className="app-control-field-label mb-1.5 block">
              {kind === 'file' ? 'File name' : 'Folder name'}
            </span>
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={placeholder}
              className="app-field"
              autoFocus
              disabled={pending}
              aria-invalid={Boolean(validationError)}
            />
          </label>

          {trimmedName && (
            <p className="text-xs text-text-secondary">
              Path: <span className="font-mono text-text">/{previewPath}</span>
              {kind === 'folder' && (
                <span className="block mt-1 text-muted">
                  Commits an empty folder to the current branch immediately.
                </span>
              )}
            </p>
          )}

          {validationError && (
            <p className="text-sm text-dashboard-danger" role="alert">
              {validationError}
            </p>
          )}

          {error && (
            <p className="text-sm text-dashboard-danger" role="alert">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <SecondaryButton type="button" disabled={pending} onClick={onClose}>
              Cancel
            </SecondaryButton>
            <PrimaryButton type="submit" disabled={!canCreate || pending}>
              {pending ? <Loader2 size={14} className="animate-spin" /> : <Icon size={14} />}
              {kind === 'file' ? 'Create file' : 'Create folder'}
            </PrimaryButton>
          </div>
        </form>
      </div>
    </div>
  )
}
