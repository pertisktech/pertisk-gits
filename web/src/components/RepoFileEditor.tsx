import { useMutation } from '@tanstack/react-query'
import { Download, Loader2, Save, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { CodeFileView } from './CodeFileView'
import { PrimaryButton, SecondaryButton } from './ui'
import { cn } from '../utils/cn'

export interface OpenFileState {
  path: string
  content: string
  savedContent: string
  isBinary: boolean
  isNew?: boolean
}

interface RepoFileEditorProps {
  token?: string | null
  orgSlug: string
  repoSlug: string
  branch: string
  refKind: 'branch' | 'tag'
  canEdit: boolean
  openFiles: OpenFileState[]
  activePath: string | null
  onActivePathChange: (path: string) => void
  onCloseFile: (path: string) => void
  onUpdateContent: (path: string, content: string) => void
  onSaved: (path: string, content: string) => void
  loadingPath?: string | null
}

export function RepoFileEditor({
  token,
  orgSlug,
  repoSlug,
  branch,
  refKind,
  canEdit,
  openFiles,
  activePath,
  onActivePathChange,
  onCloseFile,
  onUpdateContent,
  onSaved,
  loadingPath,
}: RepoFileEditorProps) {
  const activeFile = openFiles.find((file) => file.path === activePath) ?? null
  const isDirty = activeFile ? activeFile.content !== activeFile.savedContent : false
  const [commitMessage, setCommitMessage] = useState('')
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    if (!activeFile) return
    const name = activeFile.path.split('/').pop() ?? activeFile.path
    setCommitMessage(activeFile.isNew ? `Create ${name}` : `Update ${name}`)
    setSaveError(null)
  }, [activeFile?.path, activeFile?.isNew])

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!token || !activeFile) throw new Error('Not signed in')
      return api.commitRepoContents(token, orgSlug, repoSlug, {
        branch,
        message: commitMessage.trim(),
        changes: [{ path: activeFile.path, content: activeFile.content }],
      })
    },
    onSuccess: () => {
      if (activeFile) {
        onSaved(activeFile.path, activeFile.content)
      }
      setSaveError(null)
    },
    onError: (err: Error) => setSaveError(err.message),
  })

  if (openFiles.length === 0) {
    return (
      <div className="repo-explorer-empty">
        <p className="text-sm text-text-secondary">Select a file from the explorer to view or edit.</p>
      </div>
    )
  }

  return (
    <div className="repo-explorer-editor">
      <div className="repo-explorer-tabs" role="tablist">
        {openFiles.map((file) => {
          const dirty = file.content !== file.savedContent
          const name = file.path.split('/').pop() ?? file.path
          const isActive = file.path === activePath
          return (
            <div
              key={file.path}
              className={cn('repo-explorer-tab', isActive && 'repo-explorer-tab--active')}
            >
              <button
                type="button"
                role="tab"
                aria-selected={isActive}
                className="repo-explorer-tab-label"
                onClick={() => onActivePathChange(file.path)}
              >
                {dirty && <span className="repo-explorer-tab-dot" aria-label="Unsaved changes" />}
                {name}
              </button>
              <button
                type="button"
                className="repo-explorer-tab-close"
                aria-label={`Close ${name}`}
                onClick={() => onCloseFile(file.path)}
              >
                <X size={12} />
              </button>
            </div>
          )
        })}
      </div>

      {activeFile && (
        <>
          <div className="repo-explorer-toolbar">
            <span className="repo-explorer-path font-mono text-xs truncate">{activeFile.path}</span>
            <div className="flex items-center gap-2 shrink-0">
              <a
                href={api.repoRawUrl(orgSlug, repoSlug, {
                  ref: branch,
                  path: activeFile.path,
                  ref_kind: refKind,
                })}
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                onClick={(e) => {
                  if (!token) return
                  e.preventDefault()
                  const url = api.repoRawUrl(orgSlug, repoSlug, {
                    ref: branch,
                    path: activeFile.path,
                    ref_kind: refKind,
                  })
                  fetch(url, { headers: { Authorization: `Bearer ${token}` } })
                    .then((res) => {
                      if (!res.ok) throw new Error('Download failed')
                      return res.blob()
                    })
                    .then((blob) => {
                      const objectUrl = URL.createObjectURL(blob)
                      const link = document.createElement('a')
                      link.href = objectUrl
                      link.download = activeFile.path.split('/').pop() ?? 'file'
                      link.click()
                      URL.revokeObjectURL(objectUrl)
                    })
                    .catch(() => window.open(url, '_blank'))
                }}
              >
                <Download size={12} />
                Raw
              </a>
              {canEdit && isDirty && !activeFile.isBinary && (
                <>
                  <input
                    type="text"
                    value={commitMessage}
                    onChange={(e) => setCommitMessage(e.target.value)}
                    placeholder="Commit message"
                    className="repo-explorer-commit-input"
                    aria-label="Commit message"
                  />
                  <PrimaryButton
                    type="button"
                    disabled={!commitMessage.trim() || saveMutation.isPending}
                    onClick={() => saveMutation.mutate()}
                  >
                    {saveMutation.isPending ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Save size={14} />
                    )}
                    Save
                  </PrimaryButton>
                </>
              )}
            </div>
          </div>

          {saveError && (
            <div className="repo-explorer-error">{saveError}</div>
          )}

          <div className="repo-explorer-content">
            {loadingPath === activeFile.path ? (
              <div className="flex items-center gap-2 text-text-secondary text-sm p-4">
                <Loader2 size={16} className="animate-spin" />
                Loading file…
              </div>
            ) : activeFile.isBinary ? (
              <p className="text-sm text-text-secondary p-4">Binary file — preview not available.</p>
            ) : (
              <CodeFileView
                path={activeFile.path}
                content={activeFile.content}
                readOnly={!canEdit}
                onChange={(value) => onUpdateContent(activeFile.path, value)}
              />
            )}
          </div>
        </>
      )}
    </div>
  )
}

export function NewFileBar({
  onCreate,
  onCancel,
}: {
  onCreate: (path: string) => void
  onCancel: () => void
}) {
  const [path, setPath] = useState('')

  return (
    <div className="repo-explorer-new-file">
      <input
        type="text"
        value={path}
        onChange={(e) => setPath(e.target.value)}
        placeholder="path/to/file.txt"
        className="repo-explorer-commit-input flex-1"
        aria-label="New file path"
      />
      <PrimaryButton
        type="button"
        disabled={!path.trim()}
        onClick={() => onCreate(path.trim())}
      >
        Create
      </PrimaryButton>
      <SecondaryButton type="button" onClick={onCancel}>
        Cancel
      </SecondaryButton>
    </div>
  )
}
