import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { GitPullRequest, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { MarkdownBody, formatDateTime } from '../lib/collaboration'
import { Breadcrumbs, PrimaryButton } from '../components/ui'

export function PullRequestDetailPage() {
  const { slug: orgSlug = '', projectSlug = '', pullNumber = '' } = useParams()
  const number = Number(pullNumber)
  const { token } = useAuth()
  const queryClient = useQueryClient()
  const [comment, setComment] = useState('')

  const { data: repoData } = useQuery({
    queryKey: ['repository', orgSlug, projectSlug, token ?? 'public'],
    queryFn: () => api.getRepository(orgSlug, projectSlug, token),
    enabled: Boolean(orgSlug && projectSlug),
  })

  const { data, isLoading, error } = useQuery({
    queryKey: ['pull-request', orgSlug, projectSlug, number, token ?? 'public'],
    queryFn: () => api.getPullRequest(orgSlug, projectSlug, number, token),
    enabled: Boolean(orgSlug && projectSlug && number),
  })

  const { data: comments = [] } = useQuery({
    queryKey: ['pull-comments', orgSlug, projectSlug, number, token ?? 'public'],
    queryFn: () => api.listPullRequestComments(orgSlug, projectSlug, number, token),
    enabled: Boolean(orgSlug && projectSlug && number),
  })

  const mergeMutation = useMutation({
    mutationFn: () => api.mergePullRequest(token!, orgSlug, projectSlug, number),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pull-request', orgSlug, projectSlug, number] })
      queryClient.invalidateQueries({ queryKey: ['repo-pulls', orgSlug, projectSlug] })
    },
  })

  const reviewMutation = useMutation({
    mutationFn: (state: 'approved' | 'changes_requested') =>
      api.createPullRequestReview(token!, orgSlug, projectSlug, number, { state }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pull-request', orgSlug, projectSlug, number] })
    },
  })

  const commentMutation = useMutation({
    mutationFn: () => api.createPullRequestComment(token!, orgSlug, projectSlug, number, comment),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pull-comments', orgSlug, projectSlug, number] })
      setComment('')
    },
  })

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-text-secondary text-sm py-8">
        <Loader2 size={16} className="animate-spin" />
        Loading pull request…
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="p-3 rounded-lg border border-red-r1/30 bg-dashboard-danger-bg text-dashboard-danger text-sm">
        {(error as Error)?.message ?? 'Pull request not found'}
      </div>
    )
  }

  const { pull_request: pr, author, compare } = data
  const repoName = repoData?.repository.name ?? projectSlug

  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Groups', to: '/groups' },
          { label: orgSlug, to: `/groups/${orgSlug}` },
          { label: repoName, to: `/groups/${orgSlug}/projects/${projectSlug}?tab=pulls` },
          { label: `#${pr.number}` },
        ]}
      />

      <div className="gogs-panel mb-4">
        <div className="gogs-panel-body space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0">
              <GitPullRequest size={20} className="text-primary shrink-0 mt-1" />
              <div>
                <h1 className="text-lg font-semibold text-text">
                  {pr.title}{' '}
                  <span className="text-muted font-normal">#{pr.number}</span>
                </h1>
                <p className="text-sm text-text-secondary mt-1">
                  {pr.source_branch} → {pr.target_branch} · {author.username} · {formatDateTime(pr.created_at)}
                </p>
              </div>
            </div>
            {token && pr.state === 'open' && compare?.mergeable && (
              <PrimaryButton type="button" onClick={() => mergeMutation.mutate()} disabled={mergeMutation.isPending}>
                {mergeMutation.isPending ? 'Merging…' : 'Merge pull request'}
              </PrimaryButton>
            )}
          </div>

          {compare && !compare.mergeable && pr.state === 'open' && (
            <p className="text-sm text-dashboard-danger">This branch has merge conflicts.</p>
          )}

          {compare && (
            <div className="text-xs text-text-secondary flex flex-wrap gap-3">
              <span>{compare.commits.length} commits</span>
              <span>{compare.files_changed} files changed</span>
              <span className="text-dashboard-success">+{compare.insertions}</span>
              <span className="text-dashboard-danger">−{compare.deletions}</span>
            </div>
          )}

          {pr.body && (
            <div className="markdown-viewer border-t border-border pt-4">
              <MarkdownBody content={pr.body} orgSlug={orgSlug} repoSlug={projectSlug} />
            </div>
          )}

          {token && pr.state === 'open' && (
            <div className="flex flex-wrap gap-2 border-t border-border pt-4">
              <button
                type="button"
                className="px-3 py-1.5 rounded-md border border-border text-sm hover:bg-hover"
                onClick={() => reviewMutation.mutate('approved')}
                disabled={reviewMutation.isPending}
              >
                Approve
              </button>
              <button
                type="button"
                className="px-3 py-1.5 rounded-md border border-border text-sm hover:bg-hover"
                onClick={() => reviewMutation.mutate('changes_requested')}
                disabled={reviewMutation.isPending}
              >
                Request changes
              </button>
            </div>
          )}
        </div>
      </div>

      {compare?.diff && (
        <div className="gogs-panel mb-4">
          <div className="gogs-panel-header">Changes</div>
          <div className="gogs-panel-body flush">
            <pre className="gogs-diff m-0">{compare.diff}</pre>
          </div>
        </div>
      )}

      <div className="gogs-panel">
        <div className="gogs-panel-header">{comments.length} comments</div>
        <div className="gogs-panel-body space-y-4">
          {comments.map(({ comment: c, author: commentAuthor }) => (
            <div key={c.id} className="border-b border-border pb-4 last:border-0 last:pb-0">
              <div className="text-xs text-text-secondary mb-2">
                <span className="font-medium text-text">{commentAuthor.username}</span>
                {' · '}
                {formatDateTime(c.created_at)}
              </div>
              <MarkdownBody content={c.body} orgSlug={orgSlug} repoSlug={projectSlug} />
            </div>
          ))}

          {token ? (
            <form
              className="space-y-2 pt-2"
              onSubmit={(e) => {
                e.preventDefault()
                commentMutation.mutate()
              }}
            >
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Leave a comment"
                rows={4}
                className="gogs-field resize-y"
                required
              />
              <PrimaryButton type="submit" disabled={commentMutation.isPending || !comment.trim()}>
                Comment
              </PrimaryButton>
            </form>
          ) : (
            <p className="text-sm text-text-secondary">
              <Link to="/login" className="text-primary hover:underline">Sign in</Link> to comment.
            </p>
          )}
        </div>
      </div>
    </>
  )
}
