import { useQuery } from '@tanstack/react-query'
import { GitCommit, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import type { CommitInfo } from '../api/types'

function formatDate(ts: number) {
  return new Date(ts * 1000).toLocaleString()
}

export function commitUrl(orgSlug: string, repoSlug: string, sha: string) {
  return `/groups/${orgSlug}/projects/${repoSlug}/commit/${sha}`
}

interface RepoCommitsProps {
  token: string
  orgSlug: string
  repoSlug: string
  defaultBranch: string
}

export function RepoCommits({ token, orgSlug, repoSlug, defaultBranch }: RepoCommitsProps) {
  const [refOverride, setRefOverride] = useState<string | null>(null)

  const { data: browserData, isLoading: browserLoading } = useQuery({
    queryKey: ['repo-browser', orgSlug, repoSlug],
    queryFn: () => api.getRepoBrowser(token, orgSlug, repoSlug),
    enabled: Boolean(token),
  })

  const browser = browserData?.browser
  const branches = browser?.branches.length ? browser.branches : [defaultBranch]
  const ref = refOverride ?? browser?.default_ref ?? defaultBranch

  const { data, isLoading, error } = useQuery({
    queryKey: ['repo-commits', orgSlug, repoSlug, ref, 'list'],
    queryFn: () => api.getRepoCommits(token, orgSlug, repoSlug, { ref, limit: 100 }),
    enabled: Boolean(token && browser && !browser.empty),
  })

  if (browserLoading) {
    return (
      <div className="gogs-panel">
        <div className="gogs-panel-body flex items-center gap-2 text-text-secondary text-sm">
          <Loader2 size={16} className="animate-spin" />
          Loading commits…
        </div>
      </div>
    )
  }

  if (browser?.empty) {
    return (
      <div className="gogs-panel">
        <div className="gogs-panel-body text-center py-12 text-text-secondary text-sm">
          No commits yet — push to this repository to see history here.
        </div>
      </div>
    )
  }

  return (
    <div className="gogs-panel">
      <div className="gogs-toolbar">
        <select
          id="commits-branch-select"
          value={ref}
          onChange={(e) => setRefOverride(e.target.value)}
          className="gogs-branch-select"
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
        </span>
      </div>

      {error && (
        <div className="gogs-panel-body p-4 text-sm text-dashboard-danger">
          {(error as Error).message}
        </div>
      )}

      {isLoading ? (
        <div className="gogs-panel-body flex items-center gap-2 text-text-secondary text-sm p-6">
          <Loader2 size={16} className="animate-spin" />
          Loading commits…
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {(data?.commits ?? []).map((commit) => (
            <CommitRow key={commit.sha} commit={commit} orgSlug={orgSlug} repoSlug={repoSlug} />
          ))}
          {(data?.commits ?? []).length === 0 && (
            <li className="px-4 py-8 text-center text-sm text-text-secondary">No commits on this branch.</li>
          )}
        </ul>
      )}
    </div>
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
    <li>
      <Link
        to={commitUrl(orgSlug, repoSlug, commit.sha)}
        className="flex items-start gap-3 px-4 py-3 hover:bg-hover transition-colors"
      >
        <GitCommit size={16} className="text-primary shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="font-mono text-sm text-primary">{commit.short_sha}</span>
            <span className="text-sm text-text font-medium truncate">{title || commit.message}</span>
          </div>
          {bodyPreview && (
            <p className="text-xs text-text-secondary mt-1 line-clamp-2 whitespace-pre-wrap">{bodyPreview}</p>
          )}
          <div className="text-xs text-muted mt-1.5 flex flex-wrap gap-x-2">
            <span>{commit.author_name}</span>
            <span>{formatDate(commit.committed_at)}</span>
          </div>
        </div>
      </Link>
    </li>
  )
}
