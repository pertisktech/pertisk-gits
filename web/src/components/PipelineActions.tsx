import { ChevronDown, ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'
import type { JobRun, PipelineRun } from '../api/types'
import { formatDateTime } from '../lib/collaboration'
import { type JobStepView, stepDisplayStatus, stepMeta } from '../lib/pipelineLog'
import {
  displayJobStatus,
  displayRunStatus,
  formatRunDuration,
  refLabel,
  shortSha,
} from '../lib/pipelineStatus'
import { ActionsStatusIcon } from './PipelineStatus'
import { CiLogViewer } from './PipelineTerminal'
import { cn } from '../utils/cn'

function formatStepDuration(ms?: number): string {
  if (ms === undefined) return ''
  if (ms < 1000) return `${ms}ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const minutes = Math.floor(seconds / 60)
  const rem = Math.round(seconds % 60)
  return rem > 0 ? `${minutes}m ${rem}s` : `${minutes}m`
}

export function ActionsRunSummary({ run }: { run: PipelineRun }) {
  const status = displayRunStatus(run)
  const statusLabel =
    status === 'success'
      ? 'Success'
      : status === 'failure'
        ? 'Failure'
        : status === 'cancelled'
          ? 'Cancelled'
          : status === 'running'
            ? 'In progress'
            : 'Queued'

  return (
    <div className="gha-summary">
      <div className="gha-summary-grid">
        <div className="gha-summary-item">
          <span className="gha-summary-label">Status</span>
          <span className="gha-summary-value gha-summary-value--status">
            <ActionsStatusIcon status={status} size="md" />
            {statusLabel}
          </span>
        </div>
        <div className="gha-summary-item">
          <span className="gha-summary-label">Total duration</span>
          <span className="gha-summary-value">{formatRunDuration(run)}</span>
        </div>
        <div className="gha-summary-item">
          <span className="gha-summary-label">Workflow</span>
          <span className="gha-summary-value font-mono">.pertisk-ci.yaml</span>
        </div>
        <div className="gha-summary-item">
          <span className="gha-summary-label">Event</span>
          <span className="gha-summary-value">{run.event_type}</span>
        </div>
      </div>
      <div className="gha-summary-meta">
        <span>
          Triggered {formatDateTime(run.started_at ?? run.created_at)}
        </span>
        <span className="gha-summary-dot" aria-hidden>
          ·
        </span>
        <span className="font-mono">
          {shortSha(run.commit_sha)} on {refLabel(run.ref_name)}
        </span>
      </div>
    </div>
  )
}

export function ActionsJobSidebar({
  jobs,
  runStatus,
  activeJobId,
  onSelectJob,
}: {
  jobs: JobRun[]
  runStatus: PipelineRun['status']
  activeJobId: string | null
  onSelectJob: (jobId: string) => void
}) {
  return (
    <nav className="gha-job-sidebar" aria-label="Jobs">
      <div className="gha-job-sidebar-title">Jobs</div>
      <ul className="gha-job-list">
        {jobs.map((job) => {
          const status = displayJobStatus(job, runStatus)
          const active = activeJobId === job.id
          return (
            <li key={job.id}>
              <button
                type="button"
                className={cn('gha-job-item', active && 'gha-job-item--active')}
                onClick={() => onSelectJob(job.id)}
              >
                <ActionsStatusIcon status={status} size="md" />
                <span className="gha-job-item-name">{job.job_name}</span>
                <span className="gha-job-item-runner">{job.runs_on}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

export function ActionsStepList({
  steps,
  jobStatus,
  runStatus,
  activeStepKey,
  onSelectStep,
}: {
  steps: JobStepView[]
  jobStatus: JobRun['status']
  runStatus: PipelineRun['status']
  activeStepKey: string | null
  onSelectStep: (stepKey: string) => void
}) {
  if (steps.length === 0) return null

  return (
    <div className="gha-steps">
      {steps.map((step) => {
        const status = stepDisplayStatus(step, jobStatus, runStatus)
        const expanded = activeStepKey === step.key
        const duration = formatStepDuration(step.durationMs)

        return (
          <button
            key={step.key}
            type="button"
            className={cn('gha-step-row', expanded && 'gha-step-row--active')}
            aria-expanded={expanded}
            onClick={() => onSelectStep(step.key)}
          >
            <span className="gha-step-chevron" aria-hidden>
              {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </span>
            <ActionsStatusIcon status={status} size="sm" />
            <span className="gha-step-name">{step.name}</span>
            {duration && <span className="gha-step-duration">{duration}</span>}
          </button>
        )
      })}
    </div>
  )
}

export function ActionsJobHeader({
  job,
  jobStatus,
}: {
  job: JobRun
  jobStatus: JobRun['status']
}) {
  return (
    <div className="gha-job-header">
      <div className="gha-job-header-main">
        <ActionsStatusIcon status={jobStatus} size="md" />
        <h2 className="gha-job-header-title">{job.job_name}</h2>
      </div>
      <span className="gha-job-header-runner">{job.runs_on}</span>
    </div>
  )
}

export function ActionsLogPanel({
  title,
  subtitle,
  actions,
  logText,
  emptyMessage,
  footer,
}: {
  title: string
  subtitle?: string
  actions?: ReactNode
  logText: string
  emptyMessage?: string
  footer?: ReactNode
}) {
  return (
    <div className="gha-log-panel">
      <div className="gha-log-panel-header">
        <div className="gha-log-panel-titles">
          <span className="gha-log-panel-title">{title}</span>
          {subtitle && <span className="gha-log-panel-subtitle">{subtitle}</span>}
        </div>
        {actions}
      </div>
      <CiLogViewer
        className="gha-log-viewer"
        text={logText}
        emptyMessage={emptyMessage ?? '(no output)'}
      />
      {footer}
    </div>
  )
}

export function stepLogTitle(step: JobStepView | null, jobName: string): string {
  return step ? step.name : jobName
}

export function stepLogSubtitle(step: JobStepView | null): string | undefined {
  if (!step) return undefined
  const meta = stepMeta(step)
  return meta || step.run?.split('\n')[0]?.trim()
}
