import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, GitPullRequest, Loader2, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api/client'
import type { PullRequest, PullRequestReviewDetail } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { PullRequestDiff } from '../components/PullRequestDiff'
import { CommitStatuses } from '../components/CommitStatuses'
import { StatusBadge } from '../components/StatusBadge'
import { MarkdownBody, formatDateTime } from '../lib/collaboration'
import { Breadcrumbs, PrimaryButton, Alert } from '../components/ui'
import { Select, Textarea } from '../components/ui/Input'
import { projectTabPath } from '../lib/projectRoute'
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
  const [mergeStrategy, setMergeStrategy] = useState<'merge' | 'squash'>('merge')

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

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-8 text-theme-sm text-gray-500 dark:text-gray-400">
        <Loader2 size={16} className="animate-spin" />
        Loading pull request…
      </div>
    )
  }

  if (error || !data) {
    return <Alert>{(error as Error)?.message ?? 'Pull request not found'}</Alert>
  }

  const { pull_request: pr, author, compare, review_summary: reviewSummary } = data
  const repoName = repoData?.repository.name ?? projectSlug
  const approvedCount = reviewSummary.approved_count
  const hasChangesRequested = reviewSummary.changes_requested_count > 0

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

      <div className="shell-card mb-4">
        <div className="shell-card-body space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <GitPullRequest size={20} className="mt-1 shrink-0 text-brand-500" />
              <div>
                <h1 className="text-lg font-semibold text-gray-800 dark:text-white/90">
                  {pr.title}{' '}
                  <span className="font-normal text-gray-400">#{pr.number}</span>
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
                </div>
                {pr.state === 'open' && approvedCount > 0 && (
                  <p className="mt-2 text-theme-xs text-gray-500 dark:text-gray-400">
                    Approval recorded. The pull request stays{' '}
                    <strong className="text-gray-800 dark:text-white/90">Open</strong> until someone merges it.
                  </p>
                )}
                <p className="mt-1 text-theme-sm text-gray-500 dark:text-gray-400">
                  {pr.source_branch} → {pr.target_branch} · {author.username} · {formatDateTime(pr.created_at)}
                </p>
              </div>
            </div>
            {token && pr.state === 'open' && compare?.mergeable && !ciBlocking && (
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  className="!w-auto !py-2 text-theme-sm"
                  value={mergeStrategy}
                  onChange={(e) => setMergeStrategy(e.target.value as 'merge' | 'squash')}
                  disabled={mergeMutation.isPending}
                >
                  <option value="merge">Create merge commit</option>
                  <option value="squash">Squash and merge</option>
                </Select>
                <PrimaryButton
                  type="button"
                  onClick={() => mergeMutation.mutate()}
                  disabled={mergeMutation.isPending}
                >
                  {mergeMutation.isPending ? 'Merging…' : 'Merge pull request'}
                </PrimaryButton>
              </div>
            )}
          </div>

          {mergeError && <Alert>{mergeError}</Alert>}

          {compare && !compare.mergeable && pr.state === 'open' && (
            <p className="text-theme-sm text-error-500">This branch has merge conflicts.</p>
          )}

          {pr.state === 'open' && compare?.mergeable && ciBlocking && (
            <p className="text-theme-sm text-error-500">
              {ciStatuses.some((s) => s.required && s.state === 'pending')
                ? 'CI checks are still running. Merge is disabled until they finish.'
                : 'CI checks failed. Fix the pipeline before merging.'}
            </p>
          )}

          {compare && (
            <div className="flex flex-wrap gap-3 text-theme-xs text-gray-500 dark:text-gray-400">
              <span>{compare.commits.length} commits</span>
              <span>{compare.files_changed} files changed</span>
              <span className="text-success-500">+{compare.insertions}</span>
              <span className="text-error-500">−{compare.deletions}</span>
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

          {pr.body && (
            <div className="markdown-viewer border-t border-gray-200 pt-4 dark:border-gray-800">
              <MarkdownBody content={pr.body} orgSlug={orgSlug} repoSlug={projectSlug} />
            </div>
          )}

          {latestReviews.length > 0 && (
            <div className="space-y-2 border-t border-gray-200 pt-4 dark:border-gray-800">
              <h2 className="text-theme-sm font-medium text-gray-800 dark:text-white/90">Reviews</h2>
              <ul className="space-y-2">
                {latestReviews.map(({ review, reviewer }) => (
                  <li key={review.id} className="flex flex-wrap items-center gap-2 text-theme-sm">
                    <span className="font-medium text-gray-800 dark:text-white/90">@{reviewer.username}</span>
                    <StatusBadge variant={reviewVariant(review.state)}>{reviewLabel(review.state)}</StatusBadge>
                    <span className="text-theme-xs text-gray-500 dark:text-gray-400">{formatDateTime(review.created_at)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {token && pr.state === 'open' && (
            <div className="space-y-3 border-t border-gray-200 pt-4 dark:border-gray-800">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-theme-sm',
                    myLatestReview?.review.state === 'approved'
                      ? 'border-success-500/40 bg-success-50 text-success-600 dark:bg-success-500/10 dark:text-success-500'
                      : 'border-gray-200 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-white/5',
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
                    'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-theme-sm',
                    myLatestReview?.review.state === 'changes_requested'
                      ? 'border-error-500/40 bg-error-50 text-error-600 dark:bg-error-500/10 dark:text-error-500'
                      : 'border-gray-200 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-white/5',
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
                <Alert variant="info">{reviewMessage}</Alert>
              )}

              {reviewError && <Alert>{reviewError}</Alert>}
            </div>
          )}
        </div>
      </div>

      {compare?.diff && (
        <div className="shell-card mb-4">
          <div className="shell-card-header">Changes</div>
          <div className="shell-card-body flush">
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

      <div className="shell-card">
        <div className="shell-card-header">{generalComments.length} comments</div>
        <div className="shell-card-body space-y-4">
          {generalComments.map(({ comment: c, author: commentAuthor }) => (
            <div key={c.id} className="border-b border-gray-200 pb-4 last:border-0 last:pb-0 dark:border-gray-800">
              <div className="mb-2 text-theme-xs text-gray-500 dark:text-gray-400">
                <span className="font-medium text-gray-800 dark:text-white/90">{commentAuthor.username}</span>
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
              <Textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Leave a comment"
                rows={4}
                required
              />
              <PrimaryButton type="submit" disabled={commentMutation.isPending || !comment.trim()}>
                Comment
              </PrimaryButton>
            </form>
          ) : (
            <p className="text-theme-sm text-gray-500 dark:text-gray-400">
              <Link to="/login" className="text-brand-500 hover:underline dark:text-brand-400">Sign in</Link> to comment.
            </p>
          )}
        </div>
      </div>
    </>
  )
}
