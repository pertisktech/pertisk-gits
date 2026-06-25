import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import type { JobRun, PipelineRun } from '../api/types'
import {
  isCancelledStatus,
  jobStatusVariant,
  runStatusVariant,
  statusDotClass,
} from '../lib/pipelineStatus'
import { cn } from '../utils/cn'
import { StatusBadge } from './StatusBadge'

export function PipelineStatusDot({ status }: { status: string }) {
  if (isCancelledStatus(status)) {
    return (
      <span className="ci-status-dot ci-status-dot-cancelled" aria-hidden>
        <X size={8} strokeWidth={3} />
      </span>
    )
  }

  const dotClass = statusDotClass(status)
  return <span className={cn('ci-status-dot', dotClass !== 'ci-status-dot-pending' && dotClass)} aria-hidden />
}

function CancelledMark() {
  return <X size={10} strokeWidth={2.5} className="shrink-0" aria-hidden />
}

export function PipelineRunStatusBadge({ status }: { status: PipelineRun['status'] }) {
  return (
    <StatusBadge variant={runStatusVariant(status)} className="gap-1">
      {isCancelledStatus(status) && <CancelledMark />}
      {status}
    </StatusBadge>
  )
}

export function PipelineJobStatusBadge({
  status,
  children,
  className,
}: {
  status: JobRun['status'] | 'pending'
  children: ReactNode
  className?: string
}) {
  return (
    <StatusBadge variant={jobStatusVariant(status)} className={cn('gap-1', className)}>
      {isCancelledStatus(status) && <CancelledMark />}
      {children}
    </StatusBadge>
  )
}
