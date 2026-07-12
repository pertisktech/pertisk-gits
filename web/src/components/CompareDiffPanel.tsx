import { GitCompare, Loader2 } from 'lucide-react'
import { DiffViewer } from './DiffViewer'
import { EmptyState } from './ui'

export function CompareDiffPanel({
  diff,
  loading,
  error,
  emptyTitle = 'No diff',
  emptyDescription = 'These references point to the same content.',
}: {
  diff?: string | null
  loading?: boolean
  error?: string | null
  emptyTitle?: string
  emptyDescription?: string
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-text-secondary text-sm py-6">
        <Loader2 size={16} className="animate-spin" />
        Loading changes…
      </div>
    )
  }

  if (error) {
    return <div className="text-sm text-dashboard-danger py-4">{error}</div>
  }

  if (!diff?.trim()) {
    return (
      <EmptyState
        icon={<GitCompare size={40} />}
        title={emptyTitle}
        description={emptyDescription}
      />
    )
  }

  return <DiffViewer diff={diff} />
}
