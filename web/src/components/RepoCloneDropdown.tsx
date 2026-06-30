import { ChevronDown, Download, GitBranch, Lock } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import { handleUnauthorizedResponse } from '../auth/session'
import { CopyField } from './RepoClonePushGuide'

type CloneMode = 'https' | 'ssh' | 'download'

interface RepoCloneDropdownProps {
  cloneUrl: string
  authCloneUrl: string
  cloneUrlSsh?: string | null
  defaultBranch: string
  isPrivate: boolean
  orgSlug: string
  repoSlug: string
  token?: string | null
  empty?: boolean
}

export function RepoCloneDropdown({
  cloneUrl,
  authCloneUrl,
  cloneUrlSsh,
  defaultBranch,
  isPrivate,
  orgSlug,
  repoSlug,
  token,
  empty = false,
}: RepoCloneDropdownProps) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<CloneMode>('https')
  const [downloading, setDownloading] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  async function downloadRepo() {
    setDownloading(true)
    try {
      const url = api.repoArchiveUrl(orgSlug, repoSlug, {
        ref: defaultBranch,
        ref_kind: 'branch',
      })
      const response = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      })
      if (!response.ok) {
        if (token) handleUnauthorizedResponse(response.status, true)
        throw new Error('Download failed')
      }
      const blob = await response.blob()
      const objectUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = objectUrl
      link.download = `${repoSlug}-${defaultBranch}.zip`
      link.click()
      URL.revokeObjectURL(objectUrl)
    } catch {
      window.open(
        api.repoArchiveUrl(orgSlug, repoSlug, { ref: defaultBranch, ref_kind: 'branch' }),
        '_blank',
      )
    } finally {
      setDownloading(false)
    }
  }

  const modes: { id: CloneMode; label: string }[] = [
    { id: 'https', label: 'HTTPS' },
    ...(cloneUrlSsh ? [{ id: 'ssh' as const, label: 'SSH' }] : []),
    { id: 'download', label: 'Download' },
  ]

  return (
    <div className="app-clone-dropdown" ref={ref}>
      <button
        type="button"
        className="app-code-dropdown-trigger"
        data-no-global-button-hover="true"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <GitBranch size={15} />
        <span>Code</span>
        <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="app-code-dropdown">
          <div className="app-code-dropdown-tabs" role="tablist">
            {modes.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={mode === item.id}
                className={mode === item.id ? 'active' : undefined}
                onClick={() => setMode(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="app-code-dropdown-body">
            {mode === 'https' && (
              <div className="space-y-3">
                <CopyField label="Clone URL" value={cloneUrl} />
                {isPrivate && (
                  <p className="text-xs text-text-secondary flex items-start gap-1.5">
                    <Lock size={12} className="shrink-0 mt-0.5 text-blue-b1" />
                    Use your username and password when Git prompts.
                  </p>
                )}
                {!empty && (
                  <CopyField label="Clone command" value={`git clone ${cloneUrl}`} />
                )}
              </div>
            )}

            {mode === 'ssh' && cloneUrlSsh && (
              <div className="space-y-3">
                <CopyField label="Clone URL" value={cloneUrlSsh} />
                <p className="text-xs text-text-secondary">
                  Add your public key under Profile before cloning over SSH.
                </p>
                {!empty && (
                  <CopyField label="Clone command" value={`git clone ${cloneUrlSsh}`} />
                )}
              </div>
            )}

            {mode === 'download' && (
              <div className="space-y-3">
                {empty ? (
                  <p className="text-sm text-text-secondary">
                    This repository is empty — nothing to download yet.
                  </p>
                ) : (
                  <>
                    <p className="text-sm text-text-secondary">
                      Download a ZIP archive of the{' '}
                      <span className="font-mono text-text">{defaultBranch}</span> branch.
                    </p>
                    <button
                      type="button"
                      className="app-code-download-btn"
                      disabled={downloading}
                      onClick={downloadRepo}
                    >
                      <Download size={14} />
                      {downloading ? 'Downloading…' : 'Download ZIP'}
                    </button>
                  </>
                )}
              </div>
            )}

            {empty && mode !== 'download' && (
              <div className="mt-3 pt-3 border-t border-naturals-n4 space-y-3">
                <div className="text-xs font-semibold text-text-secondary uppercase tracking-wide">
                  Push an existing project
                </div>
                <pre className="m-0 p-2.5 rounded-md bg-bg border border-naturals-n4 font-mono text-[10px] text-text overflow-x-auto leading-relaxed whitespace-pre-wrap">{`git remote add origin ${authCloneUrl}
git push -u origin ${defaultBranch}`}</pre>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
