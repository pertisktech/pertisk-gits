import { ChevronDown, ChevronRight, Download, Loader2, Play, RotateCcw, Square } from 'lucide-react'
import type { JobArtifact, JobRun, PipelineRun } from '../api/types'
import {
  jobStepViews,
  stepDisplayLabel,
  stepDisplayStatus,
  stepErrorExcerpt,
  stepLogText,
  stepMeta,
} from '../lib/pipelineLog'
import { displayJobStatus, formatJobDuration } from '../lib/pipelineStatus'
import { ActionsStatusIcon } from './PipelineStatus'
import { CiLogViewer } from './PipelineTerminal'
import { cn } from '../utils/cn'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
}

export function PipelineJobStages({
  jobs,
  run,
  activeJob,
  activeStepKey,
  nowMs,
  logSession,
  onSelectJob,
  onSelectStep,
  canPlayJob,
  canRerunJob,
  playingJobId,
  rerunningJobId,
  onPlayJob,
  onRerunJob,
  canCancelStep,
  cancelPending,
  onCancelStep,
  downloadingArtifactId,
  onDownloadArtifact,
}: {
  jobs: JobRun[]
  run: PipelineRun
  activeJob: JobRun | null
  activeStepKey: string | null
  nowMs: number
  logSession: number
  onSelectJob: (jobId: string) => void
  onSelectStep: (stepKey: string) => void
  canPlayJob: (job: JobRun) => boolean
  canRerunJob: (job: JobRun) => boolean
  playingJobId: string | null
  rerunningJobId: string | null
  onPlayJob: (jobId: string) => void
  onRerunJob: (jobId: string) => void
  canCancelStep: boolean
  cancelPending: boolean
  onCancelStep: () => void
  downloadingArtifactId: string | null
  onDownloadArtifact: (artifact: JobArtifact) => void
}) {
  if (jobs.length === 0) {
    return <div className="ci-job-stages-empty">No jobs in this pipeline run.</div>
  }

  const job = activeJob
  const jobStatus = job ? displayJobStatus(job, run.status) : null
  const stages = job ? jobStepViews(job, run.status) : []
  const duration = job ? formatJobDuration(job, nowMs) : '—'

  return (
    <div className="ci-job-stages">
      {jobs.length > 1 && (
        <div className="ci-job-stage-jobs" role="tablist" aria-label="Jobs">
          {jobs.map((entry) => {
            const status = displayJobStatus(entry, run.status)
            const active = job?.id === entry.id
            return (
              <button
                key={entry.id}
                type="button"
                role="tab"
                aria-selected={active}
                className={cn('ci-job-stage-job', active && 'ci-job-stage-job--active')}
                onClick={() => onSelectJob(entry.id)}
              >
                <ActionsStatusIcon status={status} size="sm" />
                <span className="ci-job-stage-job-name">{entry.job_name}</span>
              </button>
            )
          })}
        </div>
      )}

      {job && jobStatus && (
        <div className="ci-job-stage-toolbar">
          <div className="ci-job-stage-toolbar-title">
            <ActionsStatusIcon status={jobStatus} size="md" />
            <div>
              <div className="ci-job-stage-toolbar-name">{job.job_name}</div>
              <div className="ci-job-stage-toolbar-meta">
                {duration !== '—' ? `${duration} · ${job.runs_on}` : job.runs_on}
              </div>
            </div>
          </div>
          <div className="ci-job-stage-toolbar-actions">
            {canRerunJob(job) && (
              <button
                type="button"
                className="gha-job-action gha-job-action--secondary"
                disabled={rerunningJobId === job.id}
                onClick={() => onRerunJob(job.id)}
              >
                {rerunningJobId === job.id ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <RotateCcw size={14} />
                )}
                Re-run job
              </button>
            )}
            {canPlayJob(job) && (
              <button
                type="button"
                className="gha-job-action gha-job-action--primary"
                disabled={playingJobId === job.id}
                onClick={() => onPlayJob(job.id)}
              >
                {playingJobId === job.id ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Play size={14} />
                )}
                Run job
              </button>
            )}
          </div>
        </div>
      )}

      {job && jobStatus && stages.length === 0 && (
        <div className="ci-job-stage ci-job-stage--open">
          <div className="ci-job-stage-body">
            <CiLogViewer
              text=""
              emptyMessage={
                jobStatus === 'manual'
                  ? canPlayJob(job)
                    ? 'Manual job — click Run job to start'
                    : 'Manual job — waiting for upstream jobs to finish'
                  : 'No stages in this job'
              }
            />
          </div>
        </div>
      )}

      {job && jobStatus && stages.length > 0 && (
        <div className="ci-job-stage-list">
          {stages.map((step, index) => {
            const status = stepDisplayStatus(step, jobStatus, run.status)
            const open = activeStepKey === step.key
            const logText = open ? stepLogText(job, step.key, run.status) : ''
            const failed =
              status === 'failure' ||
              (step.exitCode !== undefined && step.exitCode !== 0 && step.exitCode !== 130)
            const errorText = open && failed ? stepErrorExcerpt(logText) : null
            const meta = stepMeta(step, { nowMs, job, running: status === 'running' })
            return (
              <section
                key={step.key}
                className={cn(
                  'ci-job-stage',
                  open && 'ci-job-stage--open',
                  failed && 'ci-job-stage--failure',
                )}
              >
                <div className="ci-job-stage-head">
                  <button
                    type="button"
                    className="ci-job-stage-toggle"
                    aria-expanded={open}
                    onClick={() => onSelectStep(step.key)}
                  >
                    <span className="ci-job-stage-chevron" aria-hidden>
                      {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </span>
                    <ActionsStatusIcon status={status} size="sm" />
                    <span className="ci-job-stage-name">{stepDisplayLabel(step, index)}</span>
                    {failed && step.exitCode !== undefined && (
                      <span className="ci-job-stage-exit">exit {step.exitCode}</span>
                    )}
                    {meta && <span className="ci-job-stage-meta">{meta}</span>}
                  </button>
                  {open && canCancelStep && status === 'running' && (
                    <button
                      type="button"
                      className="gha-job-action gha-job-action--secondary ci-job-stage-cancel"
                      disabled={cancelPending}
                      onClick={onCancelStep}
                    >
                      {cancelPending ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Square size={14} />
                      )}
                      Cancel step
                    </button>
                  )}
                </div>
                {open && (
                  <div className="ci-job-stage-body">
                    {errorText && <pre className="ci-job-stage-error">{errorText}</pre>}
                    <CiLogViewer
                      key={`${job.id}-${step.key}-${logSession}`}
                      className="ci-log-viewer--fill"
                      text={logText}
                      followTail={status === 'running'}
                      emptyMessage={
                        status === 'queued' || status === 'running'
                          ? 'Waiting for log output…'
                          : status === 'cancelled'
                            ? 'Step was cancelled'
                            : 'No log output'
                      }
                    />
                  </div>
                )}
              </section>
            )
          })}
        </div>
      )}

      {job?.metrics_json && (
        <div className="ci-terminal-meta-bar ci-terminal-meta-bar--footer">
          <span>
            Queue <strong>{job.metrics_json.queue_wait_ms}ms</strong>
          </span>
          <span>
            Execute <strong>{job.metrics_json.execution_ms}ms</strong>
          </span>
          <span>
            Total <strong>{job.metrics_json.total_ms}ms</strong>
          </span>
        </div>
      )}

      {job && job.artifacts.length > 0 && (
        <div className="ci-artifacts-panel">
          <h4 className="ci-artifacts-title">Artifacts</h4>
          <ul className="ci-artifacts-list">
            {job.artifacts.map((artifact) => (
              <li key={artifact.id} className="ci-artifacts-item">
                <span className="ci-artifacts-name">{artifact.name}</span>
                <span className="ci-artifacts-meta">{formatBytes(artifact.size_bytes)}</span>
                <button
                  type="button"
                  className="ci-artifacts-download"
                  disabled={downloadingArtifactId === artifact.id}
                  onClick={() => onDownloadArtifact(artifact)}
                >
                  {downloadingArtifactId === artifact.id ? (
                    <Loader2 className="ci-artifacts-icon animate-spin" size={14} />
                  ) : (
                    <Download className="ci-artifacts-icon" size={14} />
                  )}
                  Download
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
