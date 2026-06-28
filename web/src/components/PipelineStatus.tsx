import type { ReactNode } from 'react'
import { CheckCircle2, Circle, Loader2, MinusCircle, X, XCircle } from 'lucide-react'
import type { JobRun, PipelineRun } from '../api/types'
import {
  isCancelledStatus,
  jobStatusVariant,
  runStatusVariant,
  statusDotClass,
} from '../lib/pipelineStatus'
import { cn } from '../utils/cn'
import { StatusBadge } from './StatusBadge'

const ACTIONS_ICON = {
  sm: 14,
  md: 16,
  lg: 20,
} as const

/** GitHub Actions–style status icon (check, X, spinner, hollow circle). */
export function ActionsStatusIcon({
  status,
  size = 'md',
  className,
}: {
  status: string
  size?: keyof typeof ACTIONS_ICON
  className?: string
}) {
  const px = ACTIONS_ICON[size]

  if (status === 'success') {
    return (
      <CheckCircle2
        size={px}
        className={cn('gha-status-icon gha-status-icon--success', className)}
        aria-hidden
      />
    )
  }
  if (status === 'failure') {
    return (
      <XCircle size={px} className={cn('gha-status-icon gha-status-icon--failure', className)} aria-hidden />
    )
  }
  if (isCancelledStatus(status)) {
    return (
      <MinusCircle
        size={px}
        className={cn('gha-status-icon gha-status-icon--cancelled', className)}
        aria-hidden
      />
    )
  }
  if (status === 'skipped') {
    return (
      <MinusCircle
        size={px}
        className={cn('gha-status-icon gha-status-icon--pending', className)}
        aria-hidden
      />
    )
  }
  if (status === 'running') {
    return (
      <Loader2
        size={px}
        className={cn('gha-status-icon gha-status-icon--running animate-spin', className)}
        aria-hidden
      />
    )
  }
  return (
    <Circle size={px} className={cn('gha-status-icon gha-status-icon--pending', className)} aria-hidden />
  )
}

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
