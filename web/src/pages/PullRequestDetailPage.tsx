import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, GitPullRequest, Loader2, Pencil, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api/client'
import type { PullRequest, PullRequestReviewDetail } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { PullRequestDiff } from '../components/PullRequestDiff'
import { CommitStatuses } from '../components/CommitStatuses'
import { StatusBadge } from '../components/StatusBadge'
import { MarkdownBody, formatDateTime } from '../lib/collaboration'
import { Breadcrumbs, PrimaryButton, SecondaryButton } from '../components/ui'
import { projectTabPath } from '../lib/projectRoute'
import { branchMatchesPattern } from '../lib/branchProtection'
import { cn } from '../utils/cn'

function prStateVariant(state: PullRequest['state']) {
  if (state === 'open') return 'yellow' as const
  if (state === 'merged') return 'violet' as const
  return 'gray' as const
}

function prStateLabel(state: PullRequest['state']) {
  if (state === 'open') return 'Open'
  if (state === 'merged') return 'Merged'
  return 'Closed'
}

function reviewVariant(state: PullRequestReviewDetail['review']['state']) {
  if (state === 'approved') return 'green' as const
  if (state === 'changes_requested') return 'red' as const
  return 'gray' as const
}

function reviewLabel(state: PullRequestReviewDetail['review']['state']) {
  if (state === 'approved') return 'Approved'
  if (state === 'changes_requested') return 'Changes requested'
  if (state === 'commented') return 'Commented'
  return 'Pending'
}

export function PullRequestDetailPage() {
  const { slug: orgSlug = '', projectSlug = '', pullNumber = '' } = useParams()
  const number = Number(pullNumber)
  const { token, user } = useAuth()
  const queryClient = useQueryClient()
  const [comment, setComment] = useState('')
  const [reviewMessage, setReviewMessage] = useState<string | null>(null)
  const [reviewError, setReviewError] = useState<string | null>(null)
  const [mergeError, setMergeError] = useState<string | null>(null)
  const [mergeStrategy, setMergeStrategy] = useState<'merge' | 'squash' | 'rebase'>('merge')
  const [isEditing, setIsEditing] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editBody, setEditBody] = useState('')
  const [updateError, setUpdateError] = useState<string | null>(null)

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

  const headCommitSha = data?.compare?.commits.at(-1)?.sha ?? null

  const { data: ciStatuses = [] } = useQuery({
    queryKey: ['commit-statuses', orgSlug, projectSlug, headCommitSha, token ?? ''],
    queryFn: () => api.listCommitStatuses(orgSlug, projectSlug, headCommitSha!, token),
    enabled: Boolean(token && headCommitSha),
    refetchInterval: (query) => {
      const items = query.state.data ?? []
      return items.some((s) => s.state === 'pending') ? 5000 : false
    },
  })

  const requiredCiStatuses = ciStatuses.filter((status) => status.required)
  const ciRequired = requiredCiStatuses.length > 0
  const ciBlocking =
    ciRequired &&
    requiredCiStatuses.some((s) => s.state === 'pending' || s.state === 'failure' || s.state === 'error')

  const { data: comments = [] } = useQuery({
    queryKey: ['pull-comments', orgSlug, projectSlug, number, token ?? 'public'],
    queryFn: () => api.listPullRequestComments(orgSlug, projectSlug, number, token),
    enabled: Boolean(orgSlug && projectSlug && number),
  })

  const { data: reviews = [] } = useQuery({
    queryKey: ['pull-reviews', orgSlug, projectSlug, number, token ?? 'public'],
    queryFn: () => api.listPullRequestReviews(orgSlug, projectSlug, number, token),
    enabled: Boolean(orgSlug && projectSlug && number),
  })

  const { data: protectionRules = [] } = useQuery({
    queryKey: ['branch-protection', orgSlug, projectSlug],
    queryFn: () => api.listBranchProtectionRules(token!, orgSlug, projectSlug),
    enabled: Boolean(token && orgSlug && projectSlug),
  })

  const myLatestReview = useMemo(() => {
    if (!user) return null
    return reviews.find((item) => item.reviewer.id === user.id) ?? null
  }, [reviews, user])

  const generalComments = useMemo(
    () => comments.filter(({ comment: c }) => !c.path),
    [comments],
  )

  const latestReviews = useMemo(() => {
    const seen = new Set<string>()
    return reviews.filter((item) => {
      if (seen.has(item.reviewer.id)) return false
      seen.add(item.reviewer.id)
      return true
    })
  }, [reviews])

  const mergeMutation = useMutation({
    mutationFn: () =>
      api.mergePullRequest(token!, orgSlug, projectSlug, number, { merge_strategy: mergeStrategy }),
    onSuccess: () => {
      setMergeError(null)
      queryClient.invalidateQueries({ queryKey: ['pull-request', orgSlug, projectSlug, number] })
      queryClient.invalidateQueries({ queryKey: ['repo-pulls', orgSlug, projectSlug] })
    },
    onError: (err: Error) => setMergeError(err.message),
  })

  const updateMutation = useMutation({
    mutationFn: (payload: { title?: string; body?: string; state?: 'open' | 'closed' }) =>
      api.updatePullRequest(token!, orgSlug, projectSlug, number, payload),
    onSuccess: () => {
      setUpdateError(null)
      setIsEditing(false)
      queryClient.invalidateQueries({ queryKey: ['pull-request', orgSlug, projectSlug, number] })
      queryClient.invalidateQueries({ queryKey: ['repo-pulls', orgSlug, projectSlug] })
    },
    onError: (err: Error) => setUpdateError(err.message),
  })

  const reviewMutation = useMutation({
    mutationFn: (state: 'approved' | 'changes_requested') =>
      api.createPullRequestReview(token!, orgSlug, projectSlug, number, { state }),
    onSuccess: (_data, state) => {
      setReviewError(null)
      setReviewMessage(state === 'approved' ? 'You approved this pull request.' : 'You requested changes.')
      queryClient.invalidateQueries({ queryKey: ['pull-reviews', orgSlug, projectSlug, number] })
      queryClient.invalidateQueries({ queryKey: ['pull-request', orgSlug, projectSlug, number] })
      queryClient.invalidateQueries({ queryKey: ['repo-pulls', orgSlug, projectSlug] })
      window.setTimeout(() => setReviewMessage(null), 3000)
    },
    onError: (err: Error) => {
      setReviewMessage(null)
      setReviewError(err.message)
    },
  })

  const commentMutation = useMutation({
    mutationFn: () => api.createPullRequestComment(token!, orgSlug, projectSlug, number, { body: comment }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pull-comments', orgSlug, projectSlug, number] })
      setComment('')
    },
  })

  const targetBranch = data?.pull_request.target_branch ?? ''
  const prState = data?.pull_request.state
  const mergeable = data?.compare?.mergeable ?? false
  const approvedCount = data?.review_summary.approved_count ?? 0
  const hasChangesRequested = (data?.review_summary.changes_requested_count ?? 0) > 0

  const protectionRule = useMemo(
    () =>
      protectionRules.find((rule) => branchMatchesPattern(targetBranch, rule.branch_pattern)) ?? null,
    [protectionRules, targetBranch],
  )

  const requiredApprovals = protectionRule?.required_approvals ?? 0
  const approvalsBlocking =
    Boolean(protectionRule) && requiredApprovals > 0 && approvedCount < requiredApprovals
  const changesBlocking = Boolean(protectionRule) && hasChangesRequested
  const canMerge =
    prState === 'open' && mergeable && !ciBlocking && !approvalsBlocking && !changesBlocking

  useEffect(() => {
    if (!isEditing && data) {
      setEditTitle(data.pull_request.title)
      setEditBody(data.pull_request.body ?? '')
    }
  }, [data?.pull_request.title, data?.pull_request.body, isEditing, data])

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
          { label: repoName, to: projectTabPath(`/groups/${orgSlug}/projects/${projectSlug}`, 'pulls') },
          { label: `#${pr.number}` },
        ]}
      />

      <div className="app-panel mb-4">
        <div className="app-panel-body space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0 flex-1">
              <GitPullRequest size={20} className="text-primary shrink-0 mt-1" />
              <div className="min-w-0 flex-1">
                {isEditing ? (
                  <form
                    className="space-y-3"
                    onSubmit={(e) => {
                      e.preventDefault()
                      if (!editTitle.trim()) return
                      updateMutation.mutate({
                        title: editTitle.trim(),
                        body: editBody.trim() || undefined,
                      })
                    }}
                  >
                    <input
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      className="app-field w-full"
                      required
                      disabled={updateMutation.isPending}
                    />
                    <textarea
                      value={editBody}
                      onChange={(e) => setEditBody(e.target.value)}
                      placeholder="Description (optional)"
                      rows={5}
                      className="app-field w-full resize-y"
                      disabled={updateMutation.isPending}
                    />
                    <div className="flex flex-wrap gap-2">
                      <PrimaryButton type="submit" disabled={updateMutation.isPending || !editTitle.trim()}>
                        {updateMutation.isPending ? 'Saving…' : 'Save changes'}
                      </PrimaryButton>
                      <SecondaryButton
                        type="button"
                        disabled={updateMutation.isPending}
                        onClick={() => {
                          setIsEditing(false)
                          setUpdateError(null)
                          setEditTitle(pr.title)
                          setEditBody(pr.body ?? '')
                        }}
                      >
                        Cancel
                      </SecondaryButton>
                    </div>
                  </form>
                ) : (
                  <>
                    <h1 className="text-lg font-semibold text-text">
                      {pr.title}{' '}
                      <span className="text-muted font-normal">#{pr.number}</span>
                    </h1>
                    <div className="flex flex-wrap items-center gap-2 mt-2">
                      <StatusBadge variant={prStateVariant(pr.state)}>{prStateLabel(pr.state)}</StatusBadge>
                      {approvedCount > 0 && (
                        <StatusBadge variant="green">
                          Approved{approvedCount > 1 ? ` (${approvedCount})` : ''}
                        </StatusBadge>
                      )}
                      {hasChangesRequested && (
                        <StatusBadge variant="red">Changes requested</StatusBadge>
                      )}
                      {pr.state === 'open' && approvedCount === 0 && !hasChangesRequested && (
                        <StatusBadge variant="gray">Awaiting review</StatusBadge>
                      )}
                      {protectionRule && requiredApprovals > 0 && pr.state === 'open' && (
                        <StatusBadge variant={approvalsBlocking ? 'yellow' : 'green'}>
                          {approvedCount}/{requiredApprovals} approvals
                        </StatusBadge>
                      )}
                    </div>
                    {pr.state === 'open' && approvedCount > 0 && !canMerge && !approvalsBlocking && !changesBlocking && (
                      <p className="text-xs text-text-secondary mt-2">
                        Approval recorded. The pull request stays <strong className="text-text">Open</strong> until merge checks pass.
                      </p>
                    )}
                    {pr.state === 'open' && canMerge && approvedCount > 0 && (
                      <p className="text-xs text-text-secondary mt-2">
                        Approved and ready to merge.
                      </p>
                    )}
                    <p className="text-sm text-text-secondary mt-1">
                      {pr.source_branch} → {pr.target_branch} · {author.username} · {formatDateTime(pr.created_at)}
                    </p>
                  </>
                )}
              </div>
            </div>
            {token && !isEditing && (
              <div className="flex flex-wrap items-center gap-2">
                {pr.state === 'open' && canMerge && (
                  <>
                    <select
                      className="app-field !py-1.5 !text-sm"
                      value={mergeStrategy}
                      onChange={(e) => setMergeStrategy(e.target.value as 'merge' | 'squash' | 'rebase')}
                      disabled={mergeMutation.isPending}
                    >
                      <option value="merge">Create merge commit</option>
                      <option value="squash">Squash and merge</option>
                      <option value="rebase">Rebase and merge</option>
                    </select>
                    <PrimaryButton
                      type="button"
                      onClick={() => mergeMutation.mutate()}
                      disabled={mergeMutation.isPending}
                    >
                      {mergeMutation.isPending ? 'Merging…' : 'Merge pull request'}
                    </PrimaryButton>
                  </>
                )}
                {pr.state === 'open' && (
                  <>
                    <SecondaryButton
                      type="button"
                      onClick={() => {
                        setUpdateError(null)
                        setIsEditing(true)
                      }}
                      disabled={updateMutation.isPending}
                    >
                      <Pencil size={14} />
                      Edit
                    </SecondaryButton>
                    <SecondaryButton
                      type="button"
                      onClick={() => updateMutation.mutate({ state: 'closed' })}
                      disabled={updateMutation.isPending}
                    >
                      Close pull request
                    </SecondaryButton>
                  </>
                )}
                {pr.state === 'closed' && (
                  <PrimaryButton
                    type="button"
                    onClick={() => updateMutation.mutate({ state: 'open' })}
                    disabled={updateMutation.isPending}
                  >
                    Reopen pull request
                  </PrimaryButton>
                )}
              </div>
            )}
          </div>

          {updateError && (
            <div className="p-3 rounded-md border border-red-r1/30 bg-dashboard-danger-bg text-dashboard-danger text-sm">
              {updateError}
            </div>
          )}

          {mergeError && (
            <div className="p-3 rounded-md border border-red-r1/30 bg-dashboard-danger-bg text-dashboard-danger text-sm">
              {mergeError}
            </div>
          )}

          {compare && !compare.mergeable && pr.state === 'open' && (
            <p className="text-sm text-dashboard-danger">This branch has merge conflicts.</p>
          )}

          {pr.state === 'open' && compare?.mergeable && ciBlocking && (
            <p className="text-sm text-dashboard-danger">
              {ciStatuses.some((s) => s.required && s.state === 'pending')
                ? 'CI checks are still running. Merge is disabled until they finish.'
                : 'CI checks failed. Fix the pipeline before merging.'}
            </p>
          )}

          {pr.state === 'open' && compare?.mergeable && !ciBlocking && approvalsBlocking && (
            <p className="text-sm text-dashboard-danger">
              Branch <strong className="text-text">{pr.target_branch}</strong> requires {requiredApprovals} approving
              review{requiredApprovals === 1 ? '' : 's'} ({approvedCount} received).
            </p>
          )}

          {pr.state === 'open' && compare?.mergeable && !ciBlocking && changesBlocking && (
            <p className="text-sm text-dashboard-danger">
              Merge is blocked until all change requests are resolved.
            </p>
          )}

          {compare && (
            <div className="text-xs text-text-secondary flex flex-wrap gap-3">
              <span>{compare.commits.length} commits</span>
              <span>{compare.files_changed} files changed</span>
              <span className="text-dashboard-success">+{compare.insertions}</span>
              <span className="text-dashboard-danger">−{compare.deletions}</span>
              {reviews.length > 0 && <span>{approvedCount} approval{approvedCount === 1 ? '' : 's'}</span>}
            </div>
          )}

          {headCommitSha && (
            <CommitStatuses
              orgSlug={orgSlug}
              repoSlug={projectSlug}
              commitSha={headCommitSha}
              token={token}
            />
          )}

          {!isEditing && pr.body && (
            <div className="markdown-viewer border-t border-naturals-n4 pt-4">
              <MarkdownBody content={pr.body} orgSlug={orgSlug} repoSlug={projectSlug} />
            </div>
          )}

          {latestReviews.length > 0 && (
            <div className="border-t border-naturals-n4 pt-4 space-y-2">
              <h2 className="text-sm font-medium text-text">Reviews</h2>
              <ul className="space-y-2">
                {latestReviews.map(({ review, reviewer }) => (
                  <li
                    key={review.id}
                    className="flex flex-wrap items-center gap-2 text-sm"
                  >
                    <span className="font-medium text-text">@{reviewer.username}</span>
                    <StatusBadge variant={reviewVariant(review.state)}>{reviewLabel(review.state)}</StatusBadge>
                    <span className="text-xs text-text-secondary">{formatDateTime(review.created_at)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {token && pr.state === 'open' && (
            <div className="border-t border-naturals-n4 pt-4 space-y-3">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={cn(
                    'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-sm',
                    myLatestReview?.review.state === 'approved'
                      ? 'border-green-g1/40 bg-dashboard-success-bg text-dashboard-success'
                      : 'border-naturals-n4 hover:bg-hover',
                  )}
                  onClick={() => reviewMutation.mutate('approved')}
                  disabled={reviewMutation.isPending}
                >
                  {reviewMutation.isPending ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Check size={14} />
                  )}
                  {myLatestReview?.review.state === 'approved' ? 'Approved' : 'Approve'}
                </button>
                <button
                  type="button"
                  className={cn(
                    'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-sm',
                    myLatestReview?.review.state === 'changes_requested'
                      ? 'border-red-r1/40 bg-dashboard-danger-bg text-dashboard-danger'
                      : 'border-naturals-n4 hover:bg-hover',
                  )}
                  onClick={() => reviewMutation.mutate('changes_requested')}
                  disabled={reviewMutation.isPending}
                >
                  {reviewMutation.isPending ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <X size={14} />
                  )}
                  {myLatestReview?.review.state === 'changes_requested' ? 'Changes requested' : 'Request changes'}
                </button>
              </div>

              {reviewMessage && (
                <div className="p-3 rounded-md border border-green-g1/30 bg-dashboard-success-bg text-dashboard-success text-sm">
                  {reviewMessage}
                </div>
              )}

              {reviewError && (
                <div className="p-3 rounded-md border border-red-r1/30 bg-dashboard-danger-bg text-dashboard-danger text-sm">
                  {reviewError}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {compare?.diff && (
        <div className="app-panel mb-4">
          <div className="app-panel-header">Changes</div>
          <div className="app-panel-body flush">
            <PullRequestDiff
              token={token}
              orgSlug={orgSlug}
              repoSlug={projectSlug}
              pullNumber={number}
              diff={compare.diff}
              comments={comments}
            />
          </div>
        </div>
      )}

      <div className="app-panel">
        <div className="app-panel-header">{generalComments.length} comments</div>
        <div className="app-panel-body space-y-4">
          {generalComments.map(({ comment: c, author: commentAuthor }) => (
            <div key={c.id} className="border-b border-naturals-n4 pb-4 last:border-0 last:pb-0">
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
                className="app-field resize-y"
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
