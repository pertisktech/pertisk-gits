import type { CompareResult } from '../api/types'

export function CompareSummaryStats({ compare }: { compare: CompareResult }) {
  return (
    <div className="text-xs text-text-secondary flex flex-wrap items-center gap-x-3 gap-y-1">
      <span>{compare.commits.length} commit{compare.commits.length === 1 ? '' : 's'}</span>
      <span>
        {compare.files_changed} file{compare.files_changed === 1 ? '' : 's'} changed
      </span>
      <span className="text-dashboard-success">+{compare.insertions}</span>
      <span className="text-dashboard-danger">−{compare.deletions}</span>
      <span>{compare.mergeable ? 'Mergeable' : 'Has conflicts'}</span>
    </div>
  )
}
