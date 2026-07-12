import { Check, Copy, GitCommit } from 'lucide-react'
import { useState, type MouseEvent } from 'react'
import { Link } from 'react-router-dom'
import type { CommitInfo } from '../api/types'
import { formatRelativeTime } from '../lib/relativeTime'
import { commitUrl } from './RepoCommits'

function CopyCommitButton({ sha, label }: { sha: string; label: string }) {
  const [copied, setCopied] = useState(false)

  async function copy(event: MouseEvent) {
    event.preventDefault()
    event.stopPropagation()
    try {
      await navigator.clipboard.writeText(sha)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // clipboard may be unavailable
    }
  }

  return (
    <button
      type="button"
      className="commit-history-copy"
      onClick={copy}
      title={copied ? 'Copied!' : `Copy commit ${sha}`}
      aria-label={copied ? 'Copied commit hash' : `Copy commit ${label}`}
      data-no-global-button-hover="true"
    >
      {copied ? <Check size={14} className="text-primary" /> : <Copy size={14} />}
    </button>
  )
}

function CompareCommitRow({
  commit,
  orgSlug,
  repoSlug,
}: {
  commit: CommitInfo
  orgSlug: string
  repoSlug: string
}) {
  const [title, ...rest] = commit.message.split('\n')
  const bodyPreview = rest.join('\n').trim()

  return (
    <li className="commit-history-row">
      <Link to={commitUrl(orgSlug, repoSlug, commit.sha)} className="commit-history-row-link">
        <GitCommit size={16} className="commit-history-row-icon" aria-hidden />
        <div className="commit-history-row-main">
          <div className="commit-history-row-title">
            <code className="commit-history-sha">{commit.short_sha}</code>
            <span className="commit-history-subject">{title || commit.message}</span>
          </div>
          {bodyPreview && (
            <p className="commit-history-body">{bodyPreview}</p>
          )}
          <div className="commit-history-meta">
            <span>{commit.author_name}</span>
            <span aria-hidden>·</span>
            <time dateTime={new Date(commit.committed_at * 1000).toISOString()}>
              {formatRelativeTime(commit.committed_at)}
            </time>
          </div>
        </div>
      </Link>
      <CopyCommitButton sha={commit.sha} label={commit.short_sha} />
    </li>
  )
}

export function CompareCommitList({
  commits,
  orgSlug,
  repoSlug,
  newestFirst = true,
}: {
  commits: CommitInfo[]
  orgSlug: string
  repoSlug: string
  newestFirst?: boolean
}) {
  const ordered = newestFirst ? [...commits].reverse() : commits

  if (ordered.length === 0) {
    return (
      <p className="text-sm text-text-secondary py-4">No commits in this comparison.</p>
    )
  }

  return (
    <ul className="commit-history-list">
      {ordered.map((commit) => (
        <CompareCommitRow
          key={commit.sha}
          commit={commit}
          orgSlug={orgSlug}
          repoSlug={repoSlug}
        />
      ))}
    </ul>
  )
}
