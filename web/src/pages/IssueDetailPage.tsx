import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CircleDot, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { IssueSidebar } from '../components/IssueSidebar'
import { LabelBadge } from '../components/LabelBadge'
import { MarkdownBody, formatDateTime } from '../lib/collaboration'
import { Breadcrumbs, PrimaryButton } from '../components/ui'

export function IssueDetailPage() {
  const { slug: orgSlug = '', projectSlug = '', issueNumber = '' } = useParams()
  const number = Number(issueNumber)
  const { token } = useAuth()
  const queryClient = useQueryClient()
  const [comment, setComment] = useState('')

  const { data: repoData } = useQuery({
    queryKey: ['repository', orgSlug, projectSlug, token ?? 'public'],
    queryFn: () => api.getRepository(orgSlug, projectSlug, token),
    enabled: Boolean(orgSlug && projectSlug),
  })

  const { data, isLoading, error } = useQuery({
    queryKey: ['issue', orgSlug, projectSlug, number, token ?? 'public'],
    queryFn: () => api.getIssue(orgSlug, projectSlug, number, token),
    enabled: Boolean(orgSlug && projectSlug && number),
  })

  const { data: comments = [] } = useQuery({
    queryKey: ['issue-comments', orgSlug, projectSlug, number, token ?? 'public'],
    queryFn: () => api.listIssueComments(orgSlug, projectSlug, number, token),
    enabled: Boolean(orgSlug && projectSlug && number),
  })

  const updateMutation = useMutation({
    mutationFn: (state: 'open' | 'closed') =>
      api.updateIssue(token!, orgSlug, projectSlug, number, { state }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['issue', orgSlug, projectSlug, number] })
      queryClient.invalidateQueries({ queryKey: ['repo-issues', orgSlug, projectSlug] })
    },
  })

  const commentMutation = useMutation({
    mutationFn: () => api.createIssueComment(token!, orgSlug, projectSlug, number, comment),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['issue-comments', orgSlug, projectSlug, number] })
      setComment('')
    },
  })

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-text-secondary text-sm py-8">
        <Loader2 size={16} className="animate-spin" />
        Loading issue…
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="p-3 rounded-lg border border-red-r1/30 bg-dashboard-danger-bg text-dashboard-danger text-sm">
        {(error as Error)?.message ?? 'Issue not found'}
      </div>
    )
  }

  const { issue, author, assignee, labels } = data
  const repoName = repoData?.repository.name ?? projectSlug

  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Groups', to: '/groups' },
          { label: orgSlug, to: `/groups/${orgSlug}` },
          { label: repoName, to: `/groups/${orgSlug}/projects/${projectSlug}?tab=issues` },
          { label: `#${issue.number}` },
        ]}
      />

      <div className="gogs-issue-grid">
        <div className="min-w-0 space-y-4">
          <div className="gogs-panel">
            <div className="gogs-panel-body space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  <CircleDot
                    size={20}
                    className={issue.state === 'open' ? 'text-dashboard-success shrink-0 mt-1' : 'text-muted shrink-0 mt-1'}
                  />
                  <div>
                    <h1 className="text-lg font-semibold text-text">
                      {issue.title}{' '}
                      <span className="text-muted font-normal">#{issue.number}</span>
                    </h1>
                    <p className="text-sm text-text-secondary mt-1">
                      opened by {author.username}
                      {assignee ? ` · assigned to ${assignee.username}` : ''}
                      {' · '}
                      {formatDateTime(issue.created_at)}
                    </p>
                  </div>
                </div>
                {token && (
                  <PrimaryButton
                    type="button"
                    onClick={() => updateMutation.mutate(issue.state === 'open' ? 'closed' : 'open')}
                    disabled={updateMutation.isPending}
                  >
                    {issue.state === 'open' ? 'Close issue' : 'Reopen issue'}
                  </PrimaryButton>
                )}
              </div>

              {!token && labels.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {labels.map((label) => (
                    <LabelBadge key={label.id} label={label} />
                  ))}
                </div>
              )}

              {issue.body && (
                <div className="markdown-viewer border-t border-border pt-4">
                  <MarkdownBody content={issue.body} orgSlug={orgSlug} repoSlug={projectSlug} />
                </div>
              )}
            </div>
          </div>

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
                    placeholder="Leave a comment — @username, #123, !456"
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
        </div>

        {token && (
          <IssueSidebar
            token={token}
            orgSlug={orgSlug}
            repoSlug={projectSlug}
            issueNumber={number}
            data={data}
          />
        )}
      </div>
    </>
  )
}
