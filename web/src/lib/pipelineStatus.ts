import type { JobRun, PipelineRun } from '../api/types'

export type DisplayJobStatus = JobRun['status'] | 'failure_allowed'

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

/** Skipped because a required upstream job failed or was skipped (not YAML `if:` skip). */
export function isUpstreamSkippedJob(job: JobRun): boolean {
  return (
    job.status === 'skipped' &&
    (/not run \(upstream job failed\)/i.test(job.log_text) ||
      /not run \(upstream job skipped\)/i.test(job.log_text) ||
      /not run — upstream job skipped/i.test(job.log_text) ||
      /skipped: pipeline failed/i.test(job.log_text))
  )
}

/** Jobs hidden from run UI (skipped by `if:` in YAML, never part of this run). */
export function isConfigSkippedJob(job: JobRun): boolean {
  if (job.status === 'manual') return false
  if (job.status !== 'skipped') return false
  if (isUpstreamSkippedJob(job)) return false
  return /if condition not met/i.test(job.log_text)
}

/** Jobs that belong to this run (exclude YAML `if:` skips). */
export function activeRunJobs(run: PipelineRun): JobRun[] {
  return run.jobs.filter((job) => !isConfigSkippedJob(job))
}

export function isAllowedFailure(job: JobRun): boolean {
  return job.status === 'failure' && job.required === false
}

export function isRequiredFailure(job: JobRun): boolean {
  return job.status === 'failure' && job.required !== false
}

export function hasPendingManualJobs(run: PipelineRun): boolean {
  return activeRunJobs(run).some((job) => job.status === 'manual')
}

function areJobNeedsSatisfied(job: JobRun, jobs: JobRun[]): boolean {
  const needs = job.needs ?? []
  if (needs.length === 0) return true
  return needs.every((name) => {
    const dep = jobs.find((entry) => entry.job_name === name)
    if (dep == null) return false
    return dep.status === 'success' || dep.status === 'skipped' || isAllowedFailure(dep)
  })
}

export function hasActiveJobs(run: PipelineRun): boolean {
  const jobs = activeRunJobs(run)
  return jobs.some(
    (job) =>
      job.status === 'running' ||
      (job.status === 'queued' && areJobNeedsSatisfied(job, run.jobs)),
  )
}

/** Icon/status string for pipeline list + summary (includes manual waiting). */
export function displayRunStatusIcon(run: PipelineRun): string {
  return displayRunStatus(run)
}

/** UI status — pipeline_run.status can stay "running" while failed jobs exist and others are queued. */
export function displayRunStatus(run: PipelineRun): PipelineRun['status'] {
  const { jobs, status } = run
  if (status === 'cancelled') return 'cancelled'
  if (status === 'skipped') return 'skipped'

  const actionable = activeRunJobs(run)
  if (actionable.length === 0) {
    return jobs.length > 0 ? 'skipped' : status
  }

  if (hasActiveJobs(run)) return 'running'

  if (actionable.some(isRequiredFailure)) return 'failure'
  if (actionable.some((job) => job.status === 'cancelled')) return 'cancelled'
  if (hasPendingManualJobs(run)) return 'success'
  if (actionable.every((job) => job.status === 'success')) return 'success'

  return status
}

export function displayJobStatus(
  job: JobRun,
  runStatus?: PipelineRun['status'],
): DisplayJobStatus {
  if (
    runStatus === 'cancelled' &&
    (job.status === 'running' || job.status === 'queued')
  ) {
    return 'cancelled'
  }
  if (isAllowedFailure(job)) return 'failure_allowed'
  return job.status
}

/** Jobs actively queued or executing on a runner. Manual-only waits do not count. */
export function hasExecutingJobs(run: PipelineRun): boolean {
  return hasActiveJobs(run)
}

/** Whether pipeline / job re-run actions should be disabled. */
export function blocksPipelineRerun(run: PipelineRun): boolean {
  if (hasExecutingJobs(run)) return true
  return run.status === 'pending' || run.status === 'queued'
}

export function isRunInProgress(run: PipelineRun): boolean {
  if (run.status === 'cancelled' || run.status === 'skipped') return false
  if (hasActiveJobs(run)) return true

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

export function jobStatusVariant(status: DisplayJobStatus | 'pending') {
  if (status === 'success') return 'green' as const
  if (status === 'failure_allowed') return 'yellow' as const
  if (status === 'skipped') return 'gray' as const
  if (status === 'manual') return 'yellow' as const
  if (status === 'failure' || status === 'cancelled') return 'red' as const
  if (status === 'running') return 'yellow' as const
  return 'gray' as const
}

/** CSS class for pipeline status dots (graph, sidebar, steps). */
export function statusDotClass(status: string): string {
  if (status === 'success') return 'ci-status-dot-success'
  if (status === 'failure_allowed') return 'ci-status-dot-warning'
  if (status === 'failure') return 'ci-status-dot-failure'
  if (status === 'cancelled') return 'ci-status-dot-cancelled'
  if (status === 'skipped') return 'ci-status-dot-pending'
  if (status === 'running') return 'ci-status-dot-running'
  if (status === 'manual') return 'ci-status-dot-manual'
  return 'ci-status-dot-pending'
}

export function canPlayManualJob(job: JobRun, run: PipelineRun): boolean {
  if (job.status !== 'manual') return false
  const needs = job.needs ?? []
  if (needs.length === 0) return true
  return needs.every((name) => {
    const dep = run.jobs.find((entry) => entry.job_name === name)
    if (dep == null) return false
    return dep.status === 'success' || dep.status === 'skipped' || isAllowedFailure(dep)
  })
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

export function formatRunDuration(run: PipelineRun, nowMs?: number): string {
  const startMs = new Date(run.started_at ?? run.created_at).getTime()
  const inProgress = !run.finished_at && isRunInProgress(run)
  const endMs = run.finished_at ? new Date(run.finished_at).getTime() : (nowMs ?? Date.now())

  const ms = Math.max(0, endMs - startMs)
  if (inProgress && ms < 1000) return '0s'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.round((ms % 60_000) / 1000)
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`
}

export function pipelineUrl(orgSlug: string, repoSlug: string, runId: string) {
  return `/groups/${orgSlug}/projects/${repoSlug}/pipelines/${runId}`
}

export function formatPipelineIid(iid: number): string {
  return `#${iid}`
}

export type RerunScope = 'all' | 'failed'

export function countRerunnableFailedJobs(run: PipelineRun): number {
  return run.jobs.filter(
    (j) =>
      j.status === 'failure' ||
      j.status === 'cancelled' ||
      isUpstreamSkippedJob(j),
  ).length
}

export function canRerunFailed(run: PipelineRun): boolean {
  return countRerunnableFailedJobs(run) > 0
}

export function canRerunJob(job: JobRun, run: PipelineRun): boolean {
  if (blocksPipelineRerun(run)) return false
  return job.status !== 'queued' && job.status !== 'running'
}
