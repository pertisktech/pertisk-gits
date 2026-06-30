import { Link } from 'react-router-dom'
import type { CommitInfo } from '../api/types'
import { formatRelativeTime } from '../lib/relativeTime'
import { commitUrl } from './RepoCommits'

export function RepoRefHeadSummary({
  orgSlug,
  repoSlug,
  commit,
}: {
  orgSlug: string
  repoSlug: string
  commit: CommitInfo
}) {
  const url = commitUrl(orgSlug, repoSlug, commit.sha)

  return (
    <div className="app-ref-head-commit">
      <span className="app-ref-head-commit-author">{commit.author_name}</span>
      <Link to={url} className="app-ref-head-commit-message" title={commit.message}>
        {commit.message}
      </Link>
      <Link to={url} className="commit-history-sha">
        {commit.short_sha}
      </Link>
      <time className="app-ref-head-commit-time" dateTime={new Date(commit.committed_at * 1000).toISOString()}>
        {formatRelativeTime(commit.committed_at)}
      </time>
    </div>
  )
}
