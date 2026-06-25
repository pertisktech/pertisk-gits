import { Link } from 'react-router-dom'
import type { PipelineRun } from '../api/types'
import {
  canRerunFailed,
  countRerunnableFailedJobs,
  displayJobStatus,
  displayRunStatus,
  failureSummary,
  formatRunDuration,
  isRunInProgress,
  jobStatusVariant,
  refLabel,
  runStatusVariant,
  shortSha,
  type RerunScope,
} from '../lib/pipelineStatus'
import { formatDateTime } from '../lib/collaboration'
import { PipelineRerunMenu } from './PipelineRerunMenu'
import { StatusBadge } from './StatusBadge'

export function PipelineRunsTable({
  runs,
  orgSlug,
  repoSlug,
  onOpenRun,
  onRerun,
  rerunningRunId,
}: {
  runs: PipelineRun[]
  orgSlug: string
  repoSlug: string
  onOpenRun: (runId: string) => void
  onRerun?: (runId: string, scope: RerunScope) => void
  rerunningRunId?: string | null
}) {
  if (runs.length === 0) {
    return (
      <div className="pipeline-runs-empty">
        No pipeline runs yet. Add <code className="font-mono text-xs">.pertisk-ci.yaml</code> and push,
        or click Run pipeline.
      </div>
    )
  }

  return (
    <div className="pipeline-runs-table-wrap">
      <table className="app-list-table pipeline-runs-table">
        <thead>
          <tr>
            <th>Status</th>
            <th>Pipeline</th>
            <th>Commit</th>
            <th>Branch</th>
            <th>Jobs</th>
            <th>Started</th>
            <th>Duration</th>
            {onRerun && <th className="pipeline-runs-actions-col">Actions</th>}
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <PipelineRunRow
              key={run.id}
              run={run}
              orgSlug={orgSlug}
              repoSlug={repoSlug}
              onOpen={() => onOpenRun(run.id)}
              onRerun={onRerun ? (scope) => onRerun(run.id, scope) : undefined}
              rerunLoading={rerunningRunId === run.id}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function PipelineRunRow({
  run,
  orgSlug,
  repoSlug,
  onOpen,
  onRerun,
  rerunLoading,
}: {
  run: PipelineRun
  orgSlug: string
  repoSlug: string
  onOpen: () => void
  onRerun?: (scope: RerunScope) => void
  rerunLoading?: boolean
}) {
  const status = displayRunStatus(run)
  const summary = failureSummary(run.jobs)
  const passed = run.jobs.filter((j) => j.status === 'success').length

  return (
    <tr className="pipeline-runs-row" onClick={onOpen} tabIndex={0} onKeyDown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onOpen()
      }
    }}>
      <td className="pipeline-runs-status">
        <StatusBadge variant={runStatusVariant(status)}>{status}</StatusBadge>
      </td>
      <td className="pipeline-runs-pipeline" title={summary ?? undefined}>
        <div className="pipeline-runs-pipeline-line">
          <span className="pipeline-runs-pipeline-event">{run.event_type}</span>
          <span className="pipeline-runs-pipeline-meta">
            {passed}/{run.jobs.length} jobs
          </span>
        </div>
        {summary && (
          <div className="pipeline-runs-pipeline-error" title={summary}>
            {summary}
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
          {run.jobs.map((job) => {
            const jobStatus = displayJobStatus(job, run.status)
            return (
              <span
                key={job.id}
                className="pipeline-runs-job"
                title={`${job.job_name}: ${jobStatus}`}
              >
                <StatusBadge
                  variant={jobStatusVariant(jobStatus)}
                  className="pipeline-runs-job-badge"
                >
                  {job.job_name}
                </StatusBadge>
              </span>
            )
          })}
        </div>
      </td>
      <td className="pipeline-runs-started text-sm text-text-secondary">
        {formatDateTime(run.started_at ?? run.created_at)}
      </td>
      <td className="pipeline-runs-duration font-mono text-sm text-text-secondary">
        {formatRunDuration(run)}
      </td>
      {onRerun && (
        <td className="pipeline-runs-actions" onClick={(e) => e.stopPropagation()}>
          <PipelineRerunMenu
            compact
            disabled={isRunInProgress(run)}
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
