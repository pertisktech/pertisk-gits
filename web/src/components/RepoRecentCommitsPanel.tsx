import { Link } from 'react-router-dom'
import type { CommitInfo } from '../api/types'
import { formatRelativeTime } from '../lib/relativeTime'
import { commitUrl } from './RepoCommits'

export function RepoRecentCommitsPanel({
  commits,
  orgSlug,
  repoSlug,
}: {
  commits: CommitInfo[]
  orgSlug: string
  repoSlug: string
}) {
  if (commits.length === 0) return null

  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-text m-0">Recent commits</h2>
      <div className="space-y-1">
        {commits.map((commit) => (
          <Link
            key={commit.sha}
            to={commitUrl(orgSlug, repoSlug, commit.sha)}
            className="flex items-center gap-2 rounded-lg border border-border bg-card-soft px-2.5 py-1.5 text-xs hover:border-primary/40"
          >
            <span className="rounded bg-hover px-1.5 py-0.5 font-mono text-text-secondary shrink-0">
              {commit.short_sha}
            </span>
            <span className="min-w-0 truncate text-text hover:text-primary">
              {commit.message}
            </span>
            <span className="ml-auto shrink-0 text-muted whitespace-nowrap">
              {formatRelativeTime(commit.committed_at)}
            </span>
          </Link>
        ))}
      </div>
    </section>
  )
}
