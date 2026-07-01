import { Download, Edit3, Eye, Loader2 } from 'lucide-react'
import { useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import type { BlameLine } from '../api/types'
import { formatBytes } from '../lib/formatBytes'
import { formatRelativeTime } from '../lib/relativeTime'
import { commitUrl } from './RepoCommits'
import { PrimaryButton, SecondaryButton } from './ui'

interface RepoFileBlameProps {
  token?: string | null
  orgSlug: string
  repoSlug: string
  ref: string
  refKind: 'branch' | 'tag'
  path: string
  lines: BlameLine[]
  loading?: boolean
  sizeBytes?: number | null
  canEdit: boolean
  onView: () => void
  onEdit: () => void
}

const BLAME_COLORS = [
  'var(--color-primary-p4)',
  'var(--color-success-s4)',
  'var(--color-warning-w4)',
  '#8b5cf6',
  '#ec4899',
  '#14b8a6',
  '#f97316',
  '#6366f1',
]

function blameColorForSha(sha: string): string {
  let hash = 0
  for (let i = 0; i < sha.length; i += 1) {
    hash = (hash * 31 + sha.charCodeAt(i)) >>> 0
  }
  return BLAME_COLORS[hash % BLAME_COLORS.length]
}

export function RepoFileBlame({
  token,
  orgSlug,
  repoSlug,
  ref,
  refKind,
  path,
  lines,
  loading,
  sizeBytes,
  canEdit,
  onView,
  onEdit,
}: RepoFileBlameProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const fileName = path.split('/').pop() ?? path
  const rawUrl = api.repoRawUrl(orgSlug, repoSlug, { ref, path, ref_kind: refKind })

  const lineColors = useMemo(() => {
    const map = new Map<string, string>()
    for (const line of lines) {
      if (!map.has(line.commit_sha)) {
        map.set(line.commit_sha, blameColorForSha(line.commit_sha))
      }
    }
    return map
  }, [lines])

  return (
    <div className="repo-file-preview">
      <div className="repo-file-preview-header">
        <div className="repo-file-preview-title">
          <span className="font-mono text-sm text-text">{fileName}</span>
          <span className="text-xs text-text-secondary font-mono truncate">
            {path}
            {sizeBytes != null && (
              <span className="ml-2 text-muted">· {formatBytes(sizeBytes)}</span>
            )}
            <span className="ml-2 text-muted">· Blame</span>
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
          <SecondaryButton type="button" className="!py-1 !px-2 !text-xs" onClick={onView}>
            <Eye size={14} />
            View
          </SecondaryButton>
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
            Loading blame…
          </div>
        ) : lines.length === 0 ? (
          <p className="text-sm text-text-secondary p-6">No blame data for this file.</p>
        ) : (
          <div ref={scrollRef} className="repo-blame-view">
            <table className="repo-blame-table">
              <tbody>
                {lines.map((line) => (
                  <tr key={line.line_number}>
                    <td
                      className="repo-blame-marker"
                      style={{ borderLeftColor: lineColors.get(line.commit_sha) }}
                    />
                    <td className="repo-blame-commit">
                      <Link
                        to={commitUrl(orgSlug, repoSlug, line.commit_sha)}
                        className="font-mono hover:text-primary hover:underline"
                        title={line.commit_sha}
                      >
                        {line.short_sha}
                      </Link>
                    </td>
                    <td className="repo-blame-author" title={line.author_email}>
                      {line.author_name}
                    </td>
                    <td className="repo-blame-time">
                      {formatRelativeTime(line.committed_at)}
                    </td>
                    <td className="repo-blame-line-num">{line.line_number}</td>
                    <td className="repo-blame-content">
                      <code>{line.content || ' '}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
