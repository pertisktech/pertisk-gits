import { GitPullRequest, Loader2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { StatusBadge } from '../../components/StatusBadge'
import { Breadcrumbs, PageHeader, TablePagination } from '../../components/ui'
import { useAllOpenPullRequests } from '../../hooks/useAllOpenPullRequests'
import { formatDateTime, pullUrl } from '../../lib/collaboration'
import { useClientPagination } from '../../lib/pagination'
import { formatRelativeTimeFromIso } from '../../lib/relativeTime'

export function ActivityMergeRequestsPage() {
  const { pullRequests, isLoading, error } = useAllOpenPullRequests()
  const {
    items: pagePullRequests,
    page,
    setPage,
    pageSize,
    total,
  } = useClientPagination(pullRequests)

  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Activity', to: '/activity/merge-requests' },
          { label: 'Merge requests' },
        ]}
      />
      <PageHeader
        title="Merge requests"
        subtitle="Open pull requests across your groups and repositories."
      />

      {error && (
        <div className="mb-4 p-3 rounded-lg border border-red-r1/30 bg-dashboard-danger-bg text-dashboard-danger text-sm">
          {(error as Error).message}
        </div>
      )}

      <div className="app-panel">
        <div className="app-panel-header flex items-center justify-between">
          <span>Open merge requests</span>
          <span className="font-normal text-text-secondary">{total}</span>
        </div>

        {isLoading && (
          <div className="p-8 text-center text-text-secondary text-sm flex items-center justify-center gap-2">
            <Loader2 size={16} className="animate-spin" />
            Loading merge requests…
          </div>
        )}

        {!isLoading && pullRequests.length === 0 && (
          <div className="p-8 text-center text-text-secondary text-sm">
            No open merge requests in your repositories.
          </div>
        )}

        {!isLoading && pullRequests.length > 0 && (
          <ul className="divide-y divide-naturals-n4">
            {pagePullRequests.map(({ pull_request: pr, author, review_summary: reviewSummary, orgSlug, orgName, repoSlug, repoName }) => (
              <li key={pr.id}>
                <Link
                  to={pullUrl(orgSlug, repoSlug, pr.number)}
                  className="flex items-start gap-3 px-4 py-3 hover:bg-hover no-underline text-inherit"
                >
                  <GitPullRequest
                    size={16}
                    className={
                      reviewSummary.approved_count > 0
                        ? 'text-primary shrink-0 mt-0.5'
                        : 'text-dashboard-success shrink-0 mt-0.5'
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-text">{pr.title}</span>
                      <span className="text-xs text-muted">#{pr.number}</span>
                      {reviewSummary.approved_count > 0 && (
                        <StatusBadge variant="green">Approved</StatusBadge>
                      )}
                      {reviewSummary.changes_requested_count > 0 && (
                        <StatusBadge variant="red">Changes requested</StatusBadge>
                      )}
                    </div>
                    <div className="text-xs text-text-secondary mt-1">
                      {orgName} / {repoName} · {pr.source_branch} → {pr.target_branch} · @{author.username}
                    </div>
                    <div className="text-xs text-muted mt-0.5">
                      Updated {formatRelativeTimeFromIso(pr.updated_at)} · {formatDateTime(pr.updated_at)}
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
            itemLabel="merge requests"
          />
        )}
      </div>
    </>
  )
}
