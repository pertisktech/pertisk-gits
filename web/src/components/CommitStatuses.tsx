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
      <div className="flex items-center gap-2 text-theme-sm text-gray-500 dark:text-gray-400">
        <Loader2 size={14} className="animate-spin" />
        Loading checks…
      </div>
    )
  }

  if (statuses.length === 0) return null

  const requiredStatuses = statuses.filter((status) => status.required)
  const summaryStatuses = requiredStatuses.length > 0 ? requiredStatuses : statuses
  const allPassed = summaryStatuses.every((s) => s.state === 'success')
  const anyFailed = summaryStatuses.some((s) => s.state === 'failure' || s.state === 'error')

  return (
    <div className="shell-card">
      <div className="shell-card-body space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-theme-sm font-semibold text-gray-800 dark:text-white/90">Checks</h3>
          <StatusBadge variant={anyFailed ? 'red' : allPassed ? 'green' : 'yellow'}>
            {anyFailed ? 'Failed' : allPassed ? 'All passed' : 'In progress'}
          </StatusBadge>
        </div>
        <ul className="space-y-2">
          {statuses.map((status) => (
            <li
              key={status.context}
              className="flex items-start justify-between gap-3 border-b border-gray-200 pb-2 text-theme-sm last:border-0 last:pb-0 dark:border-gray-800"
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="text-gray-500 dark:text-gray-400">{statusIcon(status.state)}</span>
                <span className="truncate font-medium text-gray-800 dark:text-white/90">{status.context}</span>
                {!status.required && (
                  <span className="font-mono text-[10px] uppercase text-gray-400">optional</span>
                )}
              </div>
              <div className="shrink-0 text-right">
                <StatusBadge variant={statusVariant(status.state)}>{status.state}</StatusBadge>
                {status.description && (
                  <p className="mt-1 max-w-[14rem] text-theme-xs text-gray-500 dark:text-gray-400">
                    {status.description}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
