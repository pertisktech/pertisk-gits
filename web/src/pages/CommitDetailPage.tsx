import { useQuery } from '@tanstack/react-query'
import { GitCommit, GitPullRequest, Loader2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { useCommitPullRequest } from '../hooks/useCommitPullRequest'
import { useProjectParams } from '../hooks/useProjectParams'
import { useProjectSubRoute } from '../hooks/useProjectSubRoute'
import { commitUrl } from '../components/RepoCommits'
import { CommitStatuses } from '../components/CommitStatuses'
import { CompareDiffPanel } from '../components/CompareDiffPanel'
import { PullRequestDiff } from '../components/PullRequestDiff'
import { Breadcrumbs, LinkButton } from '../components/ui'
import { projectBreadcrumbItems } from '../lib/groupRoute'
import { displayRepoName } from '../lib/projectInitial'
import { projectTabPath } from '../lib/projectRoute'

function formatDate(ts: number) {
  return new Date(ts * 1000).toLocaleString()
}

function compareWithParentUrl(orgSlug: string, projectSlug: string, commitSha: string, parentSha: string) {
  const base = projectTabPath(`/groups/${orgSlug}/projects/${projectSlug}`, 'compare')
  const params = new URLSearchParams({
    base: parentSha,
    base_kind: 'revision',
    head: commitSha,
    head_kind: 'revision',
  })
  return `${base}?${params}`
}

function pullRequestUrl(orgSlug: string, projectSlug: string, pullNumber: number) {
  return `/groups/${orgSlug}/projects/${projectSlug}/pulls/${pullNumber}`
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

  const { data: relatedPull, isLoading: relatedPullLoading } = useCommitPullRequest(
    orgSlug,
    projectSlug,
    commitSha,
    token,
  )

  const { data: pullComments = [] } = useQuery({
    queryKey: ['pull-comments', orgSlug, projectSlug, relatedPull?.pullNumber, token ?? ''],
    queryFn: () => api.listPullRequestComments(orgSlug, projectSlug, relatedPull!.pullNumber, token),
    enabled: Boolean(token && relatedPull?.pullNumber),
  })

  const commit = data?.commit
  const repo = repoData?.repository
  const repoName = repo ? displayRepoName(repo.name, repo.slug) : projectSlug
  const parentSha = commit?.parents[0]

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
            <div className="min-w-0 flex-1">
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
                <div className="mt-2 text-xs text-text-secondary">
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
              {parentSha && (
                <div className="mt-3">
                  <LinkButton to={compareWithParentUrl(orgSlug, projectSlug, commit.sha, parentSha)}>
                    Compare with parent
                  </LinkButton>
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

      <div className="app-panel">
        <div className="app-panel-header">
          Changes
          {commit.files_changed > 0 && (
            <span className="text-muted font-normal ml-2">({commit.files_changed})</span>
          )}
        </div>
        <div className="app-panel-body flush">
          {(relatedPullLoading || relatedPull || token) && (
            <div className="border-b border-naturals-n4 px-4 py-3">
              {relatedPullLoading && token && (
                <div className="flex items-center gap-2 text-xs text-text-secondary">
                  <Loader2 size={14} className="animate-spin" />
                  Checking open merge requests…
                </div>
              )}

              {relatedPull && (
                <div className="flex flex-wrap items-start gap-3 rounded-md border border-primary-p4/30 bg-primary-p4/5 px-3 py-2.5 text-sm">
                  <GitPullRequest size={16} className="text-primary shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <p className="text-text">
                      This commit is part of open merge request{' '}
                      <Link
                        to={pullRequestUrl(orgSlug, projectSlug, relatedPull.pullNumber)}
                        className="text-primary font-medium hover:underline"
                      >
                        #{relatedPull.pullNumber}
                      </Link>
                      {': '}
                      <span className="text-text-secondary">{relatedPull.title}</span>
                    </p>
                    <p className="text-xs text-text-secondary mt-1">
                      {relatedPull.sourceBranch} → {relatedPull.targetBranch}
                      {token && ' · Line comments are saved on the merge request.'}
                    </p>
                  </div>
                </div>
              )}

              {!relatedPull && !relatedPullLoading && token && (
                <p className="text-xs text-text-secondary">
                  Open a merge request that includes this commit to leave inline review comments.
                </p>
              )}
            </div>
          )}

          {commit.diff ? (
            token && relatedPull ? (
              <PullRequestDiff
                token={token}
                orgSlug={orgSlug}
                repoSlug={projectSlug}
                pullNumber={relatedPull.pullNumber}
                diff={commit.diff}
                comments={pullComments}
              />
            ) : (
              <CompareDiffPanel diff={commit.diff} />
            )
          ) : (
            <div className="p-4 text-sm text-text-secondary">
              No file changes in this commit.
            </div>
          )}
        </div>
      </div>
    </>
  )
}
