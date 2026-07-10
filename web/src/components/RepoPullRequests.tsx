import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { GitPullRequest, Loader2, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { pullUrl } from '../lib/collaboration'
import { EmptyState, PrimaryButton, Select, TablePagination } from './ui'
import { useClientPagination } from '../lib/pagination'

interface RepoPullRequestsProps {
  token?: string | null
  orgSlug: string
  repoSlug: string
  defaultBranch: string
}

export function RepoPullRequests({ token, orgSlug, repoSlug, defaultBranch }: RepoPullRequestsProps) {
  const queryClient = useQueryClient()
  const [stateFilter, setStateFilter] = useState<'open' | 'closed' | 'all'>('open')
  const [showNew, setShowNew] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [sourceBranch, setSourceBranch] = useState('')
  const [targetBranch, setTargetBranch] = useState(defaultBranch)

  const { data: browserData } = useQuery({
    queryKey: ['repo-browser', orgSlug, repoSlug],
    queryFn: () => api.getRepoBrowser(orgSlug, repoSlug, token),
    enabled: Boolean(orgSlug && repoSlug),
  })
  const branches = browserData?.browser.branches.length
    ? browserData.browser.branches
    : [defaultBranch]

  const { data, isLoading, error } = useQuery({
    queryKey: ['repo-pulls', orgSlug, repoSlug, stateFilter, token ?? 'public'],
    queryFn: () => api.listPullRequests(orgSlug, repoSlug, { state: stateFilter }, token),
    enabled: Boolean(orgSlug && repoSlug),
  })

  const createMutation = useMutation({
    mutationFn: () =>
      api.createPullRequest(token!, orgSlug, repoSlug, {
        title,
        body,
        source_branch: sourceBranch,
        target_branch: targetBranch,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repo-pulls', orgSlug, repoSlug] })
      setShowNew(false)
      setTitle('')
      setBody('')
      setSourceBranch('')
    },
  })

  const pulls = data?.pull_requests ?? []
  const {
    items: pagePulls,
    page,
    setPage,
    resetPage,
    pageSize,
    total,
  } = useClientPagination(pulls)

  useEffect(() => {
    resetPage()
  }, [stateFilter, resetPage])

  if (isLoading) {
    return (
      <div className="app-panel">
        <div className="app-panel-body flex items-center gap-2 text-text-secondary text-sm">
          <Loader2 size={16} className="animate-spin" />
          Loading pull requests…
        </div>
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

  return (
    <div className="space-y-4">
      <div className="repo-list-header">
        <div className="repo-list-header-segment">
          {(['open', 'closed', 'all'] as const).map((state) => (
            <button
              key={state}
              type="button"
              className={`repo-list-tab ${stateFilter === state ? 'active' : ''}`}
              onClick={() => setStateFilter(state)}
            >
              {state === 'open' && `${data?.open_count ?? 0} Open`}
              {state === 'closed' && `${data?.closed_count ?? 0} Closed`}
              {state === 'all' && 'All'}
            </button>
          ))}
        </div>
        {token && (
          <div className="repo-list-header-actions">
            <PrimaryButton type="button" className="whitespace-nowrap" onClick={() => setShowNew((v) => !v)}>
              <Plus size={14} />
              New pull request
            </PrimaryButton>
          </div>
        )}
      </div>

      {showNew && token && (
        <div className="app-panel">
          <div className="app-panel-header">New pull request</div>
          <form
            className="app-panel-body space-y-3"
            onSubmit={(e) => {
              e.preventDefault()
              createMutation.mutate()
            }}
          >
            <div className="flex flex-wrap gap-2 items-center text-sm">
              <Select
                value={sourceBranch}
                onChange={(e) => setSourceBranch(e.target.value)}
                className="app-branch-select"
                required
                aria-label="Source branch"
              >
                <option value="">Source branch</option>
                {branches.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </Select>
              <span className="text-muted">→</span>
              <Select
                value={targetBranch}
                onChange={(e) => setTargetBranch(e.target.value)}
                className="app-branch-select"
                required
                aria-label="Target branch"
              >
                {branches.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </Select>
            </div>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" required className="app-field" />
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Describe your changes (Markdown supported)"
              rows={5}
              className="app-field resize-y"
            />
            <div className="flex gap-2">
              <PrimaryButton
                type="submit"
                disabled={createMutation.isPending || !title.trim() || !sourceBranch || sourceBranch === targetBranch}
              >
                {createMutation.isPending ? 'Creating…' : 'Create pull request'}
              </PrimaryButton>
              <button type="button" className="px-3 py-2 text-sm text-text-secondary" onClick={() => setShowNew(false)}>
                Cancel
              </button>
            </div>
            {createMutation.error && (
              <p className="text-sm text-dashboard-danger">{(createMutation.error as Error).message}</p>
            )}
          </form>
        </div>
      )}

      <div className="app-panel">
        {pulls.length === 0 ? (
          <EmptyState
            icon={<GitPullRequest size={40} />}
            title={stateFilter === 'open' ? 'No open pull requests' : 'No pull requests found'}
            description={
              stateFilter === 'open'
                ? 'Propose changes and review code before merging. GitLab users: these work like merge requests.'
                : 'Try a different filter.'
            }
            action={
              token && stateFilter !== 'closed' ? (
                <PrimaryButton type="button" onClick={() => setShowNew(true)}>
                  <Plus size={14} />
                  New pull request
                </PrimaryButton>
              ) : undefined
            }
          />
        ) : (
          <ul className="divide-y divide-naturals-n4">
            {pagePulls.map(({ pull_request: pr, author, review_summary: reviewSummary }) => (
              <li key={pr.id}>
                <Link
                  to={pullUrl(orgSlug, repoSlug, pr.number)}
                  className="flex items-start gap-3 px-4 py-3 hover:bg-hover no-underline text-inherit"
                >
                  <GitPullRequest
                    size={16}
                    className={
                      pr.state === 'open'
                        ? reviewSummary.approved_count > 0
                          ? 'text-primary shrink-0 mt-0.5'
                          : 'text-dashboard-success shrink-0 mt-0.5'
                        : pr.state === 'merged'
                          ? 'text-primary shrink-0 mt-0.5'
                          : 'text-muted shrink-0 mt-0.5'
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-text">{pr.title}</span>
                      <span className="text-xs text-muted">#{pr.number}</span>
                      {pr.state === 'open' && reviewSummary.approved_count > 0 && (
                        <span className="text-xs px-2 py-0.5 rounded-full status-green">Approved</span>
                      )}
                      {pr.state === 'open' && reviewSummary.changes_requested_count > 0 && (
                        <span className="text-xs px-2 py-0.5 rounded-full status-red">Changes requested</span>
                      )}
                    </div>
                    <div className="text-xs text-text-secondary mt-1">
                      {pr.source_branch} → {pr.target_branch} · {author.username}
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {!isLoading && total > 0 && (
          <TablePagination
            page={page}
            pageSize={pageSize}
            total={total}
            onPageChange={setPage}
            itemLabel="pull requests"
          />
        )}
      </div>
    </div>
  )
}
