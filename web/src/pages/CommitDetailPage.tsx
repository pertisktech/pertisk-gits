import { useQuery } from '@tanstack/react-query'
import { GitCommit, Loader2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { useProjectParams } from '../hooks/useProjectParams'
import { useProjectSubRoute } from '../hooks/useProjectSubRoute'
import { commitUrl } from '../components/RepoCommits'
import { CommitStatuses } from '../components/CommitStatuses'
import { DiffViewer } from '../components/DiffViewer'
import { Breadcrumbs } from '../components/ui'
import { projectBreadcrumbItems } from '../lib/groupRoute'
import { displayRepoName } from '../lib/projectInitial'
import { projectTabPath } from '../lib/projectRoute'

function formatDate(ts: number) {
  return new Date(ts * 1000).toLocaleString()
}

export function CommitDetailPage() {
  const { orgSlug, projectSlug } = useProjectParams()
  const projectSub = useProjectSubRoute()
  const commitSha = projectSub?.kind === 'commit' ? projectSub.commitSha : ''
  const { token } = useAuth()

  const { data: groups = [] } = useQuery({
    queryKey: ['organizations'],
    queryFn: () => api.listOrganizations(token!),
    enabled: Boolean(token),
  })

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
  const repo = repoData?.repository
  const repoName = repo ? displayRepoName(repo.name, repo.slug) : projectSlug

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-text-secondary text-sm py-8">
        <Loader2 size={16} className="animate-spin" />
        Loading commit…
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-3 rounded-lg border border-red-r1/30 bg-dashboard-danger-bg text-dashboard-danger text-sm">
        {(error as Error).message}
      </div>
    )
  }

  if (!commit) return null

  return (
    <>
      <Breadcrumbs
        items={projectBreadcrumbItems({
          orgPath: orgSlug,
          groups,
          projectName: repoName,
          projectTo: `/groups/${orgSlug}/projects/${projectSlug}`,
          suffix: [
            { label: 'Commits', to: projectTabPath(`/groups/${orgSlug}/projects/${projectSlug}`, 'commits') },
            { label: commit.short_sha },
          ],
        })}
      />

      <div className="app-panel mb-4">
        <div className="app-panel-body space-y-4">
          <div className="flex items-start gap-3">
            <GitCommit size={20} className="text-primary shrink-0 mt-0.5" />
            <div className="min-w-0">
              <h1 className="text-lg font-semibold text-text whitespace-pre-wrap">{commit.message}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text-secondary">
                <span className="font-mono text-primary">{commit.sha}</span>
                <span>{commit.author_name}</span>
                <span className="text-muted">{commit.author_email}</span>
                <span>{formatDate(commit.committed_at)}</span>
              </div>
              {(commit.files_changed > 0 || commit.insertions > 0 || commit.deletions > 0) && (
                <div className="mt-2 text-xs text-text-secondary flex flex-wrap gap-3">
                  {commit.files_changed > 0 && (
                    <span>
                      {commit.files_changed} file{commit.files_changed === 1 ? '' : 's'} changed
                    </span>
                  )}
                  <span>
                    <span className="text-dashboard-success">+{commit.insertions}</span>
                    {' '}
                    <span className="text-dashboard-danger">−{commit.deletions}</span>
                  </span>
                </div>
              )}
              {commit.parents.length > 0 && (
                <div className="mt-3 text-xs text-text-secondary">
                  <span className="text-muted mr-2">Parents</span>
                  {commit.parents.map((parent, i) => (
                    <span key={parent}>
                      {i > 0 && ', '}
                      <Link
                        to={commitUrl(orgSlug, projectSlug, parent)}
                        className="font-mono text-primary hover:underline"
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
            <pre className="m-0 p-3 rounded-md border border-naturals-n4 bg-surface text-sm text-text whitespace-pre-wrap font-sans">
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
        <div className="app-panel">
          <div className="app-panel-header">Changes</div>
          <div className="app-panel-body flush">
            <DiffViewer diff={commit.diff} />
          </div>
        </div>
      ) : (
        <div className="app-panel">
          <div className="app-panel-body text-sm text-text-secondary">No file changes in this commit.</div>
        </div>
      )}
    </>
  )
}
