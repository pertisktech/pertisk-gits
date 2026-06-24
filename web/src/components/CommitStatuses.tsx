import { useQuery } from '@tanstack/react-query'
import { Check, Loader2, X } from 'lucide-react'
import { api } from '../api/client'
import type { CommitStatus } from '../api/types'
import { StatusBadge } from './StatusBadge'

function statusVariant(state: CommitStatus['state']) {
  if (state === 'success') return 'green' as const
  if (state === 'failure' || state === 'error') return 'red' as const
  if (state === 'pending') return 'yellow' as const
  return 'gray' as const
}

function statusIcon(state: CommitStatus['state']) {
  if (state === 'success') return <Check size={14} />
  if (state === 'failure' || state === 'error') return <X size={14} />
  if (state === 'pending') return <Loader2 size={14} className="animate-spin" />
  return null
}

export function CommitStatuses({
  orgSlug,
  repoSlug,
  commitSha,
  token,
}: {
  orgSlug: string
  repoSlug: string
  commitSha: string
  token?: string | null
}) {
  const { data: statuses = [], isLoading } = useQuery({
    queryKey: ['commit-statuses', orgSlug, repoSlug, commitSha, token ?? 'public'],
    queryFn: () => api.listCommitStatuses(orgSlug, repoSlug, commitSha, token),
    enabled: Boolean(orgSlug && repoSlug && commitSha),
    refetchInterval: (query) => {
      const items = query.state.data ?? []
      return items.some((s) => s.state === 'pending') ? 5000 : false
    },
  })

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-text-secondary">
        <Loader2 size={14} className="animate-spin" />
        Loading checks…
      </div>
    )
  }

  if (statuses.length === 0) return null

  const allPassed = statuses.every((s) => s.state === 'success')
  const anyFailed = statuses.some((s) => s.state === 'failure' || s.state === 'error')

  return (
    <div className="gogs-panel p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-text">Checks</h3>
        <StatusBadge variant={anyFailed ? 'red' : allPassed ? 'green' : 'yellow'}>
          {anyFailed ? 'Failed' : allPassed ? 'All passed' : 'In progress'}
        </StatusBadge>
      </div>
      <ul className="space-y-2">
        {statuses.map((status) => (
          <li
            key={status.context}
            className="flex items-start justify-between gap-3 text-sm border-b border-border/60 pb-2 last:border-0 last:pb-0"
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-text-secondary">{statusIcon(status.state)}</span>
              <span className="font-medium text-text truncate">{status.context}</span>
            </div>
            <div className="text-right shrink-0">
              <StatusBadge variant={statusVariant(status.state)}>
                {status.state}
              </StatusBadge>
              {status.description && (
                <p className="text-xs text-text-secondary mt-1 max-w-[14rem]">{status.description}</p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
