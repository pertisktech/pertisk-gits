import { Download, Edit3, History, Loader2, ScanLine } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import type { EntryLastCommit } from '../api/types'
import { formatBytes } from '../lib/formatBytes'
import { isImagePath } from '../lib/imagePreview'
import { formatRelativeTime } from '../lib/relativeTime'
import { commitUrl } from './RepoCommits'
import { CodeFileView } from './CodeFileView'
import { RepoImagePreview } from './RepoImagePreview'
import { RepoMarkdownBody } from './RepoMarkdownBody'
import { PrimaryButton, SecondaryButton } from './ui'

interface RepoFilePreviewProps {
  token?: string | null
  orgSlug: string
  repoSlug: string
  ref: string
  refKind: 'branch' | 'tag'
  path: string
  content: string
  isBinary: boolean
  loading?: boolean
  sizeBytes?: number | null
  lastCommit?: EntryLastCommit | null
  canEdit: boolean
  onEdit: () => void
  onBlame?: () => void
}

export function RepoFilePreview({
  token,
  orgSlug,
  repoSlug,
  ref,
  refKind,
  path,
  content,
  isBinary,
  loading,
  sizeBytes,
  lastCommit,
  canEdit,
  onEdit,
  onBlame,
}: RepoFilePreviewProps) {
  const [copied, setCopied] = useState(false)
  const fileName = path.split('/').pop() ?? path
  const isMarkdown = /\.(md|markdown)$/i.test(path)
  const rawUrl = api.repoRawUrl(orgSlug, repoSlug, { ref, path, ref_kind: refKind })

  async function copyPath() {
    try {
      await navigator.clipboard.writeText(path)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="repo-file-preview">
      {lastCommit && (
        <div className="repo-file-preview-commit">
          <Link
            to={commitUrl(orgSlug, repoSlug, lastCommit.sha)}
            className="repo-file-preview-commit-message hover:text-primary hover:underline truncate"
            title={lastCommit.message}
          >
            {lastCommit.message}
          </Link>
          <span className="repo-file-preview-commit-meta shrink-0">
            {lastCommit.short_sha} · {formatRelativeTime(lastCommit.committed_at)}
          </span>
        </div>
      )}

      <div className="repo-file-preview-header">
        <div className="repo-file-preview-title">
          <span className="font-mono text-sm text-text">{fileName}</span>
          <span className="text-xs text-text-secondary font-mono truncate">
            {path}
            {sizeBytes != null && (
              <span className="ml-2 text-muted">· {formatBytes(sizeBytes)}</span>
            )}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
          <SecondaryButton
            type="button"
            className="!py-1 !px-2 !text-xs"
            onClick={() => void copyPath()}
          >
            {copied ? 'Copied' : 'Copy path'}
          </SecondaryButton>
          {lastCommit && (
            <Link
              to={commitUrl(orgSlug, repoSlug, lastCommit.sha)}
              className="inline-flex items-center gap-1 text-xs text-text-secondary hover:text-primary"
            >
              <History size={14} />
              History
            </Link>
          )}
          {onBlame && !isBinary && (
            <SecondaryButton type="button" className="!py-1 !px-2 !text-xs" onClick={onBlame}>
              <ScanLine size={14} />
              Blame
            </SecondaryButton>
          )}
          <a
            href={rawUrl}
            className="inline-flex items-center gap-1 text-xs text-text-secondary hover:text-primary"
            onClick={(e) => {
              if (!token) return
              e.preventDefault()
              fetch(rawUrl, { headers: { Authorization: `Bearer ${token}` } })
                .then((res) => {
                  if (!res.ok) throw new Error('Download failed')
                  return res.blob()
                })
                .then((blob) => {
                  const objectUrl = URL.createObjectURL(blob)
                  const link = document.createElement('a')
                  link.href = objectUrl
                  link.download = fileName
                  link.click()
                  URL.revokeObjectURL(objectUrl)
                })
                .catch(() => window.open(rawUrl, '_blank'))
            }}
          >
            <Download size={14} />
            Raw
          </a>
          {canEdit && (
            <PrimaryButton type="button" className="!py-1 !px-2.5 !text-xs" onClick={onEdit}>
              <Edit3 size={14} />
              Edit
            </PrimaryButton>
          )}
        </div>
      </div>

      <div className="repo-file-preview-body">
        {loading ? (
          <div className="flex items-center gap-2 text-text-secondary text-sm p-6">
            <Loader2 size={16} className="animate-spin" />
            Loading file…
          </div>
        ) : isImagePath(path) ? (
          <RepoImagePreview
            orgSlug={orgSlug}
            repoSlug={repoSlug}
            ref={ref}
            refKind={refKind}
            path={path}
            token={token}
          />
        ) : isBinary ? (
          <p className="text-sm text-text-secondary p-6">Binary file — preview not available.</p>
        ) : isMarkdown ? (
          <div className="markdown-viewer markdown-viewer-content p-6 text-sm text-text">
            <RepoMarkdownBody
              content={content}
              markdownPath={path}
              orgSlug={orgSlug}
              repoSlug={repoSlug}
              ref={ref}
              refKind={refKind}
              token={token}
            />
          </div>
        ) : (
          <CodeFileView path={path} content={content} readOnly />
        )}
      </div>
    </div>
  )
}
