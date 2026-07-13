import { Link } from 'react-router-dom'
import { useEffect, useState } from 'react'
import type { PipelineRun } from '../api/types'
import { formatDateTime } from '../lib/collaboration'
import { formatRelativeTimeFromIso } from '../lib/relativeTime'
import { filterRunJobsForList, filterRunJobsForManualDeploy } from '../lib/pipelineSummary'
import {
  canRerunFailed,
  countRerunnableFailedJobs,
  displayJobStatus,
  displayRunStatus,
  failureSummary,
  formatRunDuration,
  formatPipelineIid,
  blocksPipelineRerun,
  isRunInProgress,
  refLabel,
  runStatusVariant,
  shortSha,
  type RerunScope,
} from '../lib/pipelineStatus'
import { ActionsStatusIcon } from './PipelineStatus'
import { PipelineRerunMenu } from './PipelineRerunMenu'
import { StatusBadge } from './StatusBadge'
import { TablePagination } from './ui'
import { useClientPagination } from '../lib/pagination'

export type PipelineListFilter = 'all' | 'running'

export function filterPipelineRuns(runs: PipelineRun[], filter: PipelineListFilter): PipelineRun[] {
  if (filter === 'running') return runs.filter((run) => isRunInProgress(run))
  return runs
}

export function PipelineRunsTable({
  runs,
  orgSlug,
  repoSlug,
  onOpenRun,
  onRerun,
  rerunningRunId,
  emptyMessage,
}: {
  runs: PipelineRun[]
  orgSlug: string
  repoSlug: string
  onOpenRun: (runId: string, jobId?: string) => void
  onRerun?: (runId: string, scope: RerunScope) => void
  rerunningRunId?: string | null
  emptyMessage?: string
}) {
  const {
    items: pageRuns,
    page,
    setPage,
    pageSize,
    total,
  } = useClientPagination(runs)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const hasInProgressRuns = runs.some((run) => isRunInProgress(run))

  useEffect(() => {
    if (!hasInProgressRuns) return
    const timer = window.setInterval(() => {
      setNowMs(Date.now())
    }, 1000)
    return () => window.clearInterval(timer)
  }, [hasInProgressRuns])

  if (runs.length === 0) {
    return (
      <div className="pipeline-runs-empty">
        {emptyMessage ?? (
          <>
            No pipeline runs yet. Add{' '}
            <code className="font-mono text-xs">.pertisk-ci.yaml</code> and push to start a
            pipeline.
          </>
        )}
      </div>
    )
  }

  return (
    <>
      <div className="pipeline-runs-table-wrap">
        <table className="app-list-table pipeline-runs-table">
          <thead>
            <tr>
              <th>Status</th>
              <th>Pipeline</th>
              <th>Commit</th>
              <th>Branch</th>
              <th>Stages</th>
              <th>Started</th>
              <th>Duration</th>
              {onRerun && <th className="pipeline-runs-actions-col">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {pageRuns.map((run) => (
              <PipelineRunRow
                key={run.id}
                run={run}
                orgSlug={orgSlug}
                repoSlug={repoSlug}
                onOpen={() => onOpenRun(run.id)}
                onOpenJob={(jobId) => onOpenRun(run.id, jobId)}
                onRerun={onRerun ? (scope) => onRerun(run.id, scope) : undefined}
                rerunLoading={rerunningRunId === run.id}
                nowMs={nowMs}
              />
            ))}
          </tbody>
        </table>
      </div>
      {total > 0 && (
        <TablePagination
          page={page}
          pageSize={pageSize}
          total={total}
          onPageChange={setPage}
          itemLabel="pipelines"
        />
      )}
    </>
  )
}

function PipelineRunRow({
  run,
  orgSlug,
  repoSlug,
  onOpen,
  onOpenJob,
  onRerun,
  rerunLoading,
  nowMs,
}: {
  run: PipelineRun
  orgSlug: string
  repoSlug: string
  onOpen: () => void
  onOpenJob: (jobId: string) => void
  onRerun?: (scope: RerunScope) => void
  rerunLoading?: boolean
  nowMs: number
}) {
  const status = displayRunStatus(run)
  const inProgress = isRunInProgress(run)
  const visibleJobs =
    run.event_type === 'manual' && run.target_environment
      ? filterRunJobsForManualDeploy(run)
      : filterRunJobsForList(run)
  const summary = failureSummary(visibleJobs)
  const passed = visibleJobs.filter((job) => displayJobStatus(job, run.status) === 'success').length
  const timeReference = run.started_at ?? run.created_at
  const relative = formatRelativeTimeFromIso(timeReference)
  const startedLabel = inProgress ? relative : formatDateTime(timeReference)

  return (
    <tr
      className="pipeline-runs-row"
      onClick={onOpen}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
    >
      <td className="pipeline-runs-status">
        <StatusBadge variant={runStatusVariant(status)}>{status}</StatusBadge>
      </td>
      <td className="pipeline-runs-pipeline" title={summary ?? undefined}>
        <div className="pipeline-runs-pipeline-line">
          <span className="pipeline-runs-pipeline-event font-mono">
            {formatPipelineIid(run.pipeline_iid)}
          </span>
          <span className="pipeline-runs-pipeline-meta capitalize">{run.event_type}</span>
          <span className="pipeline-runs-pipeline-meta">
            {passed}/{visibleJobs.length} jobs
          </span>
        </div>
        {summary && (
          <div className="pipeline-runs-pipeline-error" title={summary}>
            {summary}
          </div>
        )}
        {run.target_environment && (
          <div className="pipeline-runs-pipeline-meta mt-0.5 font-mono">
            {run.target_environment}
          </div>
        )}
      </td>
      <td className="pipeline-runs-sha">
        <Link
          to={`/groups/${orgSlug}/projects/${repoSlug}/commit/${run.commit_sha}`}
          className="font-mono text-sm text-primary hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {shortSha(run.commit_sha)}
        </Link>
      </td>
      <td className="pipeline-runs-branch font-mono text-sm text-text-secondary">
        {refLabel(run.ref_name)}
      </td>
      <td className="pipeline-runs-jobs-cell">
        <div className="pipeline-runs-jobs">
          {visibleJobs.map((job) => {
            const jobStatus = displayJobStatus(job, run.status)
            return (
              <button
                key={job.id}
                type="button"
                className="pipeline-runs-job-btn"
                title={`${job.job_name} (${jobStatus})`}
                aria-label={`${job.job_name}: ${jobStatus}`}
                onClick={(e) => {
                  e.stopPropagation()
                  onOpenJob(job.id)
                }}
              >
                <ActionsStatusIcon status={jobStatus} size="sm" />
              </button>
            )
          })}
        </div>
      </td>
      <td className="pipeline-runs-started text-sm text-text-secondary" title={startedLabel}>
        {inProgress ? relative : formatDateTime(timeReference)}
      </td>
      <td className="pipeline-runs-duration font-mono text-sm text-text-secondary">
        {formatRunDuration(run, nowMs)}
      </td>
      {onRerun && (
        <td className="pipeline-runs-actions" onClick={(e) => e.stopPropagation()}>
          <PipelineRerunMenu
            compact
            disabled={blocksPipelineRerun(run)}
            loading={rerunLoading}
            canRerunFailed={canRerunFailed(run)}
            failedCount={countRerunnableFailedJobs(run)}
            onRerun={onRerun}
          />
        </td>
      )}
    </tr>
  )
}
