import { ChevronDown, ChevronRight, Download, Loader2, Play, RotateCcw, Square } from 'lucide-react'
import { useEffect, useState } from 'react'
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
  const [openSteps, setOpenSteps] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    setOpenSteps(new Set(activeStepKey ? [activeStepKey] : []))
  }, [activeJob?.id, logSession])

  useEffect(() => {
    if (!activeStepKey) return
    setOpenSteps((current) => {
      if (current.has(activeStepKey)) return current
      const next = new Set(current)
      next.add(activeStepKey)
      return next
    })
  }, [activeStepKey])

  if (jobs.length === 0) {
    return <div className="gl-jobs-empty">No jobs in this pipeline run.</div>
  }

  const job = activeJob ?? jobs[0]
  const jobStatus = displayJobStatus(job, run.status)
  const duration = formatJobDuration(job, nowMs)
  const stages = jobStepViews(job, run.status)

  function toggleStep(stepKey: string) {
    setOpenSteps((current) => {
      const next = new Set(current)
      if (next.has(stepKey)) next.delete(stepKey)
      else next.add(stepKey)
      return next
    })
    onSelectStep(stepKey)
  }

  return (
    <div className="gl-jobs">
      <nav className="gl-jobs-nav" aria-label="Jobs">
        <div className="gl-jobs-nav-title">Jobs</div>
        <ul className="gl-jobs-nav-list">
          {jobs.map((entry) => {
            const status = displayJobStatus(entry, run.status)
            const selected = entry.id === job.id
            const entryDuration = formatJobDuration(entry, nowMs)
            return (
              <li key={entry.id}>
                <button
                  type="button"
                  className={cn('gl-jobs-nav-item', selected && 'gl-jobs-nav-item--active')}
                  aria-current={selected ? 'true' : undefined}
                  data-no-global-button-hover="true"
                  onClick={() => onSelectJob(entry.id)}
                >
                  <ActionsStatusIcon status={status} size="sm" />
                  <span className="gl-jobs-nav-name">{entry.job_name}</span>
                  <span className="gl-jobs-nav-time">
                    {entryDuration !== '—' ? entryDuration : ''}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </nav>

      <div className="gl-jobs-trace">
        <header className="gl-jobs-trace-head">
          <div className="gl-jobs-trace-title">
            <ActionsStatusIcon status={jobStatus} size="md" />
            <div>
              <h2 className="gl-jobs-trace-name">{job.job_name}</h2>
              <p className="gl-jobs-trace-meta">
                {duration !== '—' ? `${duration} · ` : ''}
                {job.runs_on}
              </p>
            </div>
          </div>
          <div className="gl-jobs-trace-actions">
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
                Retry
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
                Run
              </button>
            )}
            {canCancelStep && job.id === activeJob?.id && (
              <button
                type="button"
                className="gha-job-action gha-job-action--secondary"
                disabled={cancelPending}
                onClick={onCancelStep}
              >
                {cancelPending ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Square size={14} />
                )}
                Cancel
              </button>
            )}
          </div>
        </header>

        {stages.length === 0 ? (
          <div className="gl-jobs-section-body">
            <CiLogViewer
              text=""
              emptyMessage={
                jobStatus === 'manual'
                  ? canPlayJob(job)
                    ? 'Manual job. Run it when you are ready.'
                    : 'Manual job. Waiting for earlier jobs to finish.'
                  : 'This job has no script sections yet.'
              }
            />
          </div>
        ) : (
          <div className="gl-jobs-sections">
            {stages.map((step, index) => {
              const status = stepDisplayStatus(step, jobStatus, run.status)
              const open = openSteps.has(step.key)
              const logText = open ? stepLogText(job, step.key, run.status) : ''
              const failed =
                status === 'failure' ||
                (step.exitCode !== undefined && step.exitCode !== 0 && step.exitCode !== 130)
              const errorText = open && failed ? stepErrorExcerpt(logText) : null
              const meta = stepMeta(step, { nowMs, job, running: status === 'running' })
              return (
                <section
                  key={step.key}
                  className={cn('gl-jobs-section', failed && 'gl-jobs-section--failure')}
                >
                  <button
                    type="button"
                    className="gl-jobs-section-toggle"
                    aria-expanded={open}
                    data-no-global-button-hover="true"
                    onClick={() => toggleStep(step.key)}
                  >
                    {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    <ActionsStatusIcon status={status} size="sm" />
                    <span className="gl-jobs-section-name">{stepDisplayLabel(step, index)}</span>
                    {failed && step.exitCode !== undefined && (
                      <span className="gl-jobs-section-exit">exit {step.exitCode}</span>
                    )}
                    {meta && <span className="gl-jobs-section-time">{meta}</span>}
                  </button>
                  {open && (
                    <div className="gl-jobs-section-body">
                      {errorText && <pre className="gl-jobs-section-error">{errorText}</pre>}
                      <CiLogViewer
                        key={`${job.id}-${step.key}-${logSession}`}
                        className="ci-log-viewer--stage"
                        text={logText}
                        followTail={status === 'running'}
                        emptyMessage={
                          status === 'queued' || status === 'running'
                            ? 'Waiting for log output…'
                            : status === 'cancelled'
                              ? 'This section was cancelled.'
                              : 'No log output.'
                        }
                      />
                    </div>
                  )}
                </section>
              )
            })}
          </div>
        )}

        {job.metrics_json && (
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

        {job.artifacts.length > 0 && (
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
    </div>
  )
}
