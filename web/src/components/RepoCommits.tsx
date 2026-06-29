import { useQuery } from '@tanstack/react-query'
import { Check, ChevronDown, ChevronRight, Copy, GitCommit, Loader2 } from 'lucide-react'
import { useState, type MouseEvent } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import type { CommitInfo } from '../api/types'
import {
  groupCommitsByDate,
  shouldExpandCommitDateGroup,
  type CommitDateGroup,
} from '../lib/commitGroups'
import { formatRelativeTime } from '../lib/relativeTime'
import { cn } from '../utils/cn'
import { EmptyState } from './ui'

export function commitUrl(orgSlug: string, repoSlug: string, sha: string) {
  return `/groups/${orgSlug}/projects/${repoSlug}/commit/${sha}`
}

interface RepoCommitsProps {
  token?: string | null
  orgSlug: string
  repoSlug: string
  defaultBranch: string
}

export function RepoCommits({ token, orgSlug, repoSlug, defaultBranch }: RepoCommitsProps) {
  const [refOverride, setRefOverride] = useState<string | null>(null)

  const { data: browserData, isLoading: browserLoading } = useQuery({
    queryKey: ['repo-browser', orgSlug, repoSlug],
    queryFn: () => api.getRepoBrowser(orgSlug, repoSlug, token),
    enabled: Boolean(orgSlug && repoSlug),
  })

  const browser = browserData?.browser
  const branches = browser?.branches.length ? browser.branches : [defaultBranch]
  const ref = refOverride ?? browser?.default_ref ?? defaultBranch

  const { data, isLoading, error } = useQuery({
    queryKey: ['repo-commits', orgSlug, repoSlug, ref, 'list'],
    queryFn: () => api.getRepoCommits(orgSlug, repoSlug, { ref, limit: 100 }, token),
    enabled: Boolean(orgSlug && repoSlug && browser && !browser.empty),
  })

  const dateGroups = groupCommitsByDate(data?.commits ?? [])

  if (browserLoading) {
    return (
      <div className="app-panel">
        <div className="app-panel-body flex items-center gap-2 text-text-secondary text-sm">
          <Loader2 size={16} className="animate-spin" />
          Loading commits…
        </div>
      </div>
    )
  }

  if (browser?.empty) {
    return (
      <div className="app-panel">
        <EmptyState
          icon={<GitCommit size={40} />}
          title="No commits yet"
          description="Push to this repository using the clone URL on the Code tab to see commit history here."
        />
      </div>
    )
  }

  return (
    <div className="app-panel">
      <div className="app-toolbar">
        <select
          id="commits-branch-select"
          value={ref}
          onChange={(e) => setRefOverride(e.target.value)}
          className="app-branch-select"
          aria-label="Branch"
        >
          {branches.map((branch) => (
            <option key={branch} value={branch}>
              {branch}
            </option>
          ))}
        </select>
        <span className="text-xs text-text-secondary">
          {data?.commits.length ?? 0} commit{(data?.commits.length ?? 0) === 1 ? '' : 's'}
          {dateGroups.length > 0 && (
            <>
              {' '}
              · {dateGroups.length} day{dateGroups.length === 1 ? '' : 's'}
            </>
          )}
        </span>
      </div>

      {error && (
        <div className="app-panel-body p-4 text-sm text-dashboard-danger">
          {(error as Error).message}
        </div>
      )}

      {isLoading ? (
        <div className="app-panel-body flex items-center gap-2 text-text-secondary text-sm p-6">
          <Loader2 size={16} className="animate-spin" />
          Loading commits…
        </div>
      ) : dateGroups.length === 0 ? (
        <EmptyState
          icon={<GitCommit size={40} />}
          title="No commits on this branch"
          description="This branch has no commits yet, or history has not been fetched."
        />
      ) : (
        <div className="commit-history-groups">
          {dateGroups.map((group, index) => (
            <CommitDateGroup
              key={group.key}
              group={group}
              orgSlug={orgSlug}
              repoSlug={repoSlug}
              defaultOpen={shouldExpandCommitDateGroup(group.key, index)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function CommitDateGroup({
  group,
  orgSlug,
  repoSlug,
  defaultOpen,
}: {
  group: CommitDateGroup
  orgSlug: string
  repoSlug: string
  defaultOpen: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <section className={cn('commit-history-date', open && 'commit-history-date--open')}>
      <button
        type="button"
        className="commit-history-date-toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="commit-history-date-chevron" aria-hidden>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
        <span className="commit-history-date-label">{group.label}</span>
        <span className="commit-history-date-count">
          {group.commits.length} commit{group.commits.length === 1 ? '' : 's'}
        </span>
      </button>

      {open && (
        <ul className="commit-history-date-body">
          {group.commits.map((commit) => (
            <CommitRow
              key={commit.sha}
              commit={commit}
              orgSlug={orgSlug}
              repoSlug={repoSlug}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

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

function CommitRow({
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
