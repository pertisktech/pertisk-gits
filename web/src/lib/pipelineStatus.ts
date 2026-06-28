import type { JobRun, PipelineRun } from '../api/types'

export function failureSummary(jobs: JobRun[]): string | null {
  const failed = jobs.filter((job) => job.status === 'failure')
  if (failed.length === 0) return null

  const log = failed[0].log_text.trim()
  if (!log) return `Job "${failed[0].job_name}" failed`

  const checkout = log.match(/checkout failed: (.+)/)?.[1]
  if (checkout) return checkout

  const stepFailed = log.match(/=== .+ \(exit [1-9]\d*\)/)?.[0]
  if (stepFailed) return stepFailed.replace(/^=== /, '')

  const line = log.split('\n').find((entry) => entry.trim() && !entry.startsWith('==='))
  return line?.trim().slice(0, 160) ?? `Job "${failed[0].job_name}" failed`
}

/** UI status — pipeline_run.status can stay "running" while failed jobs exist and others are queued. */
export function displayRunStatus(run: PipelineRun): PipelineRun['status'] {
  const { jobs, status } = run
  if (status === 'cancelled') return 'cancelled'
  if (status === 'skipped') return 'skipped'
  if (jobs.length === 0) return status

  const hasRunning = jobs.some((j) => j.status === 'running')
  const hasFailed = jobs.some((j) => j.status === 'failure')
  const allSkipped = jobs.every((j) => j.status === 'skipped')
  const allTerminal = jobs.every(
    (j) =>
      j.status === 'success' ||
      j.status === 'failure' ||
      j.status === 'cancelled' ||
      j.status === 'skipped',
  )

  if (allTerminal) {
    if (hasFailed) return 'failure'
    if (jobs.some((j) => j.status === 'cancelled')) return 'cancelled'
    if (allSkipped) return 'skipped'
    return 'success'
  }

  if (hasFailed && !hasRunning) {
    return 'failure'
  }

  return status
}

export function displayJobStatus(
  job: JobRun,
  runStatus?: PipelineRun['status'],
): JobRun['status'] {
  if (
    runStatus === 'cancelled' &&
    (job.status === 'running' || job.status === 'queued')
  ) {
    return 'cancelled'
  }
  return job.status
}

export function isRunInProgress(run: PipelineRun): boolean {
  if (run.status === 'cancelled' || run.status === 'skipped') return false

  const hasActiveJob = run.jobs.some(
    (job) => job.status === 'queued' || job.status === 'running',
  )
  if (!hasActiveJob) return false

  const displayStatus = displayRunStatus(run)
  return displayStatus === 'running' || displayStatus === 'queued' || displayStatus === 'pending'
}

export function runStatusVariant(status: PipelineRun['status']) {
  if (status === 'success') return 'green' as const
  if (status === 'failure' || status === 'cancelled') return 'red' as const
  if (status === 'skipped') return 'gray' as const
  if (status === 'running') return 'yellow' as const
  return 'gray' as const
}

export function jobStatusVariant(status: JobRun['status'] | 'pending') {
  if (status === 'success') return 'green' as const
  if (status === 'skipped') return 'gray' as const
  if (status === 'failure' || status === 'cancelled') return 'red' as const
  if (status === 'running') return 'yellow' as const
  return 'gray' as const
}

/** CSS class for pipeline status dots (graph, sidebar, steps). */
export function statusDotClass(status: string): string {
  if (status === 'success') return 'ci-status-dot-success'
  if (status === 'failure') return 'ci-status-dot-failure'
  if (status === 'cancelled') return 'ci-status-dot-cancelled'
  if (status === 'running') return 'ci-status-dot-running'
  return 'ci-status-dot-pending'
}

export function isCancelledStatus(status: string) {
  return status === 'cancelled'
}

export function shortSha(sha: string) {
  return sha.slice(0, 7)
}

export function refLabel(refName: string) {
  return refName.replace(/^refs\/heads\//, '').replace(/^refs\/tags\//, 'tag:')
}

export function formatRunDuration(run: PipelineRun): string {
  const startMs = new Date(run.started_at ?? run.created_at).getTime()
  const endMs = run.finished_at ? new Date(run.finished_at).getTime() : Date.now()
  if (!run.finished_at && isRunInProgress(run)) return '…'

  const ms = Math.max(0, endMs - startMs)
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.round((ms % 60_000) / 1000)
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`
}

export function pipelineUrl(orgSlug: string, repoSlug: string, runId: string) {
  return `/groups/${orgSlug}/projects/${repoSlug}/pipelines/${runId}`
}

export type RerunScope = 'all' | 'failed'

export function countRerunnableFailedJobs(run: PipelineRun): number {
  return run.jobs.filter((j) => j.status === 'failure' || j.status === 'cancelled').length
}

export function canRerunFailed(run: PipelineRun): boolean {
  return countRerunnableFailedJobs(run) > 0
}
