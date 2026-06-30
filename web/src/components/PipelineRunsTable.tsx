import { Link } from 'react-router-dom'
import type { PipelineRun } from '../api/types'
import { formatRelativeTime, parseIsoTimestamp } from '../lib/relativeTime'
import { filterRunJobsForList, filterRunJobsForManualDeploy } from '../lib/pipelineSummary'
import {
  canRerunFailed,
  countRerunnableFailedJobs,
  displayJobStatus,
  displayRunStatusIcon,
  failureSummary,
  formatRunDuration,
  isRunInProgress,
  refLabel,
  shortSha,
  type RerunScope,
} from '../lib/pipelineStatus'
import { ActionsStatusIcon } from './PipelineStatus'
import { PipelineRerunMenu } from './PipelineRerunMenu'
import { TablePagination } from './ui'
import { useClientPagination } from '../lib/pagination'

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
  const {
    items: pageRuns,
    page,
    setPage,
    pageSize,
    total,
  } = useClientPagination(runs)

  if (runs.length === 0) {
    return (
      <div className="gha-runs-empty">
        No workflow runs yet. Add <code className="font-mono text-xs">.pertisk-ci.yaml</code> and
        push to start a pipeline.
      </div>
    )
  }

  return (
    <>
      <div className="gha-runs-list">
        {pageRuns.map((run) => (
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
      </div>
      {total > 0 && (
        <TablePagination
          page={page}
          pageSize={pageSize}
          total={total}
          onPageChange={setPage}
          itemLabel="runs"
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
  const status = displayRunStatusIcon(run)
  const visibleJobs =
    run.event_type === 'manual' && run.target_environment
      ? filterRunJobsForManualDeploy(run)
      : filterRunJobsForList(run)
  const summary = failureSummary(visibleJobs)
  const startedAt = run.started_at ?? run.created_at
  const relative = formatRelativeTime(parseIsoTimestamp(startedAt))

  return (
    <div className="gha-run-row-wrap">
      <button
        type="button"
        className="gha-run-row"
        onClick={onOpen}
      >
        <ActionsStatusIcon status={status} size="lg" className="gha-run-row-icon" />
        <div className="gha-run-row-body">
          <div className="gha-run-row-title">
            <span className="font-mono">.pertisk-ci.yaml</span>
            <span className="gha-run-row-event">{run.event_type}</span>
          </div>
          <div className="gha-run-row-sub">
            <Link
              to={`/groups/${orgSlug}/projects/${repoSlug}/commit/${run.commit_sha}`}
              className="font-mono text-primary hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              {shortSha(run.commit_sha)}
            </Link>
            <span className="gha-summary-dot" aria-hidden>
              ·
            </span>
            <span className="font-mono">{refLabel(run.ref_name)}</span>
            {run.target_environment && (
              <>
                <span className="gha-summary-dot" aria-hidden>
                  ·
                </span>
                <span className="font-mono text-text-secondary">{run.target_environment}</span>
              </>
            )}
            {summary && (
              <span className="gha-run-row-error" title={summary}>
                — {summary}
              </span>
            )}
          </div>
          <div className="gha-run-row-jobs">
            {visibleJobs.map((job) => (
              <span key={job.id} className="gha-run-row-job" title={job.job_name}>
                <ActionsStatusIcon status={displayJobStatus(job, run.status)} size="sm" />
                <span>{job.job_name}</span>
              </span>
            ))}
          </div>
        </div>
        <div className="gha-run-row-meta">
          <span>{formatRunDuration(run)}</span>
          <span>{relative}</span>
        </div>
      </button>
      {onRerun && (
        <div className="gha-run-row-actions" onClick={(e) => e.stopPropagation()}>
          <PipelineRerunMenu
            compact
            disabled={isRunInProgress(run)}
            loading={rerunLoading}
            canRerunFailed={canRerunFailed(run)}
            failedCount={countRerunnableFailedJobs(run)}
            onRerun={onRerun}
          />
        </div>
      )}
    </div>
  )
}
