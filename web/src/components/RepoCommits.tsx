import { useQuery } from '@tanstack/react-query'
import { GitCommit, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import type { CommitInfo } from '../api/types'
import { Alert, EmptyState } from './ui'
import { Select } from './ui/Input'

function formatDate(ts: number) {
  return new Date(ts * 1000).toLocaleString()
}

export function commitUrl(orgSlug: string, repoSlug: string, sha: string) {
  return `/groups/${orgSlug}/projects/${repoSlug}/commit/${sha}`
}

interface RepoCommitsProps {
  token?: string | null
  orgSlug: string
  repoSlug: string
  defaultBranch: string
}

const compactSelect = '!w-auto !py-1.5 !text-theme-sm'

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

  if (browserLoading) {
    return (
      <div className="shell-card">
        <div className="shell-card-body flex items-center gap-2 text-theme-sm text-gray-500 dark:text-gray-400">
          <Loader2 size={16} className="animate-spin" />
          Loading commits…
        </div>
      </div>
    )
  }

  if (browser?.empty) {
    return (
      <div className="shell-card">
        <EmptyState
          icon={<GitCommit size={40} />}
          title="No commits yet"
          description="Push to this repository using the clone URL on the Code tab to see commit history here."
        />
      </div>
    )
  }

  return (
    <div className="shell-card">
      <div className="shell-repo-toolbar">
        <Select
          id="commits-branch-select"
          value={ref}
          onChange={(e) => setRefOverride(e.target.value)}
          className={compactSelect}
          aria-label="Branch"
        >
          {branches.map((branch) => (
            <option key={branch} value={branch}>
              {branch}
            </option>
          ))}
        </Select>
        <span className="text-theme-xs text-gray-500 dark:text-gray-400">
          {data?.commits.length ?? 0} commit{(data?.commits.length ?? 0) === 1 ? '' : 's'}
        </span>
      </div>

      {error && (
        <div className="shell-card-body !py-4">
          <Alert>{(error as Error).message}</Alert>
        </div>
      )}

      {isLoading ? (
        <div className="shell-card-body flex items-center gap-2 text-theme-sm text-gray-500 dark:text-gray-400">
          <Loader2 size={16} className="animate-spin" />
          Loading commits…
        </div>
      ) : (
        <ul className="divide-y divide-gray-200 dark:divide-gray-800">
          {(data?.commits ?? []).map((commit) => (
            <CommitRow key={commit.sha} commit={commit} orgSlug={orgSlug} repoSlug={repoSlug} />
          ))}
          {(data?.commits ?? []).length === 0 && (
            <li>
              <EmptyState
                icon={<GitCommit size={40} />}
                title="No commits on this branch"
                description="This branch has no commits yet, or history has not been fetched."
              />
            </li>
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
        className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-gray-50 dark:hover:bg-white/5"
      >
        <GitCommit size={16} className="mt-0.5 shrink-0 text-brand-500" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="font-mono text-theme-sm text-brand-500 dark:text-brand-400">{commit.short_sha}</span>
            <span className="truncate text-theme-sm font-medium text-gray-800 dark:text-white/90">
              {title || commit.message}
            </span>
          </div>
          {bodyPreview && (
            <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-theme-xs text-gray-500 dark:text-gray-400">
              {bodyPreview}
            </p>
          )}
          <div className="mt-1.5 flex flex-wrap gap-x-2 text-theme-xs text-gray-400">
            <span>{commit.author_name}</span>
            <span>{formatDate(commit.committed_at)}</span>
          </div>
        </div>
      </Link>
    </li>
  )
}
