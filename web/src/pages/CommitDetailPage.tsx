import { useQuery } from '@tanstack/react-query'
import { GitCommit, Loader2 } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { commitUrl } from '../components/RepoCommits'
import { CommitStatuses } from '../components/CommitStatuses'
import { DiffViewer } from '../components/DiffViewer'
import { Alert, Breadcrumbs } from '../components/ui'
import { projectTabPath } from '../lib/projectRoute'

function formatDate(ts: number) {
  return new Date(ts * 1000).toLocaleString()
}

export function CommitDetailPage() {
  const { slug: orgSlug = '', projectSlug = '', commitSha = '' } = useParams()
  const { token } = useAuth()

  const { data: groups = [] } = useQuery({
    queryKey: ['organizations'],
    queryFn: () => api.listOrganizations(token!),
    enabled: Boolean(token),
  })
  const group = groups.find((g) => g.slug === orgSlug)

  const { data: repoData } = useQuery({
    queryKey: ['repository', orgSlug, projectSlug, token ?? 'public'],
    queryFn: () => api.getRepository(orgSlug, projectSlug, token),
    enabled: Boolean(orgSlug && projectSlug),
  })

  const { data, isLoading, error } = useQuery({
    queryKey: ['repo-commit', orgSlug, projectSlug, commitSha, token ?? 'public'],
    queryFn: () => api.getRepoCommit(orgSlug, projectSlug, commitSha, token),
    enabled: Boolean(orgSlug && projectSlug && commitSha),
  })

  const commit = data?.commit
  const repoName = repoData?.repository.name ?? projectSlug

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-8 text-theme-sm text-gray-500 dark:text-gray-400">
        <Loader2 size={16} className="animate-spin" />
        Loading commit…
      </div>
    )
  }

  if (error) {
    return <Alert>{(error as Error).message}</Alert>
  }

  if (!commit) return null

  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Groups', to: '/groups' },
          { label: group?.name ?? orgSlug, to: `/groups/${orgSlug}` },
          { label: repoName, to: `/groups/${orgSlug}/projects/${projectSlug}` },
          { label: 'Commits', to: projectTabPath(`/groups/${orgSlug}/projects/${projectSlug}`, 'commits') },
          { label: commit.short_sha },
        ]}
      />

      <div className="shell-card mb-4">
        <div className="shell-card-body space-y-4">
          <div className="flex items-start gap-3">
            <GitCommit size={20} className="mt-0.5 shrink-0 text-brand-500" />
            <div className="min-w-0">
              <h1 className="whitespace-pre-wrap text-lg font-semibold text-gray-800 dark:text-white/90">
                {commit.message}
              </h1>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-theme-sm text-gray-500 dark:text-gray-400">
                <span className="font-mono text-brand-500 dark:text-brand-400">{commit.sha}</span>
                <span>{commit.author_name}</span>
                <span className="text-gray-400">{commit.author_email}</span>
                <span>{formatDate(commit.committed_at)}</span>
              </div>
              {(commit.files_changed > 0 || commit.insertions > 0 || commit.deletions > 0) && (
                <div className="mt-2 flex flex-wrap gap-3 text-theme-xs text-gray-500 dark:text-gray-400">
                  {commit.files_changed > 0 && (
                    <span>
                      {commit.files_changed} file{commit.files_changed === 1 ? '' : 's'} changed
                    </span>
                  )}
                  <span>
                    <span className="text-success-500">+{commit.insertions}</span>
                    {' '}
                    <span className="text-error-500">−{commit.deletions}</span>
                  </span>
                </div>
              )}
              {commit.parents.length > 0 && (
                <div className="mt-3 text-theme-xs text-gray-500 dark:text-gray-400">
                  <span className="mr-2 text-gray-400">Parents</span>
                  {commit.parents.map((parent, i) => (
                    <span key={parent}>
                      {i > 0 && ', '}
                      <Link
                        to={commitUrl(orgSlug, projectSlug, parent)}
                        className="font-mono text-brand-500 hover:underline dark:text-brand-400"
                      >
                        {parent.slice(0, 7)}
                      </Link>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {commit.body && commit.body !== commit.message && (
            <pre className="m-0 whitespace-pre-wrap rounded-lg border border-gray-200 bg-gray-50 p-3 font-sans text-theme-sm text-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-white/90">
              {commit.body}
            </pre>
          )}

          <CommitStatuses
            orgSlug={orgSlug}
            repoSlug={projectSlug}
            commitSha={commit.sha}
            token={token}
          />
        </div>
      </div>

      {commit.diff ? (
        <div className="shell-card">
          <div className="shell-card-header">Changes</div>
          <div className="shell-card-body flush">
            <DiffViewer diff={commit.diff} />
          </div>
        </div>
      ) : (
        <div className="shell-card">
          <div className="shell-card-body text-theme-sm text-gray-500 dark:text-gray-400">
            No file changes in this commit.
          </div>
        </div>
      )}
    </>
  )
}
