import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Download, Loader2, RefreshCw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import {
  CiLogViewer,
  CiPrompt,
  CiRunLine,
  CiTerminal,
} from '../components/PipelineTerminal'
import { PipelineGraph, jobsFromRun } from '../components/PipelineGraph'
import { displayRunStatus, isRunInProgress, refLabel, runStatusVariant, shortSha } from '../components/RepoPipelines'
import { StatusBadge } from '../components/StatusBadge'
import { projectTabPath } from '../lib/projectRoute'
import { Breadcrumbs, PrimaryButton } from '../components/ui'
import { formatDateTime } from '../lib/collaboration'
import {
  inferRunningStepName,
  jobStepViews,
  stepDisplayStatus,
  stepLogText,
  stepMeta,
} from '../lib/pipelineLog'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
}

export function PipelineRunDetailPage() {
  const { slug: orgSlug = '', projectSlug = '', runId = '' } = useParams()
  const { token } = useAuth()
  const queryClient = useQueryClient()
  const [activeJobId, setActiveJobId] = useState<string | null>(null)
  const [activeStepKey, setActiveStepKey] = useState<string | null>(null)
  const [downloadingArtifactId, setDownloadingArtifactId] = useState<string | null>(null)

  const { data: repoData } = useQuery({
    queryKey: ['repository', orgSlug, projectSlug, token ?? 'public'],
    queryFn: () => api.getRepository(orgSlug, projectSlug, token),
    enabled: Boolean(orgSlug && projectSlug),
  })

  const { data: run, isLoading, error } = useQuery({
    queryKey: ['pipeline-run', orgSlug, projectSlug, runId],
    queryFn: () => api.getPipelineRun(token!, orgSlug, projectSlug, runId),
    enabled: Boolean(token && orgSlug && projectSlug && runId),
    refetchInterval: (query) => {
      const item = query.state.data
      if (!item) return false
      return isRunInProgress(item) ? 1000 : false
    },
  })

  const activeJob = useMemo(() => {
    if (!run) return null
    if (activeJobId) {
      return run.jobs.find((job) => job.id === activeJobId) ?? run.jobs[0] ?? null
    }
    return run.jobs[0] ?? null
  }, [run, activeJobId])

  const activeSteps = useMemo(
    () => (activeJob ? jobStepViews(activeJob) : []),
    [activeJob],
  )

  useEffect(() => {
    setActiveStepKey(null)
  }, [activeJob?.id])

  useEffect(() => {
    if (!activeJob || activeJob.status !== 'running') return
    const running = inferRunningStepName(activeJob)
    if (running && running !== activeStepKey) {
      setActiveStepKey(running)
    }
  }, [activeJob, activeStepKey])

  const selectJob = (jobId: string) => {
    setActiveJobId(jobId)
    setActiveStepKey(null)
  }

  const logText = activeJob ? stepLogText(activeJob, activeStepKey) : ''
  const activeStep = activeSteps.find((step) => step.key === activeStepKey) ?? null
  const runningStepName =
    activeJob && activeJob.status === 'running' ? inferRunningStepName(activeJob) : null

  const rerunMutation = useMutation({
    mutationFn: () => api.rerunPipeline(token!, orgSlug, projectSlug, runId),
    onSuccess: (updatedRun) => {
      queryClient.setQueryData(['pipeline-run', orgSlug, projectSlug, runId], updatedRun)
      queryClient.invalidateQueries({ queryKey: ['pipeline-runs', orgSlug, projectSlug] })
      setActiveJobId(null)
      setActiveStepKey(null)
    },
  })

  const repoName = repoData?.repository.name ?? projectSlug

  if (!token) {
    return <div className="text-sm text-text-secondary py-8">Sign in to view pipeline runs.</div>
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-text-secondary py-8">
        <Loader2 size={16} className="animate-spin" />
        Loading pipeline…
      </div>
    )
  }

  if (error || !run) {
    return (
      <div className="p-3 rounded-lg border border-red-r1/30 bg-dashboard-danger-bg text-dashboard-danger text-sm">
        {(error as Error)?.message ?? 'Pipeline run not found'}
      </div>
    )
  }

  const passed = run.jobs.filter((j) => j.status === 'success').length
  const branch = refLabel(run.ref_name)

  const repoPath = `/groups/${orgSlug}/projects/${projectSlug}`
  const pipelinesPath = projectTabPath(repoPath, 'pipelines')

  return (
    <div className="pipeline-run-page">
      <Breadcrumbs
        items={[
          { label: 'Repositories', to: '/groups' },
          { label: repoName, to: pipelinesPath },
          { label: `run ${shortSha(run.commit_sha)}` },
        ]}
      />

      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            to={pipelinesPath}
            className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-primary mb-2"
          >
            <ArrowLeft size={14} />
            Back to pipelines
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold text-text font-mono">pipeline run</h1>
            <StatusBadge variant={runStatusVariant(displayRunStatus(run))}>
              {displayRunStatus(run)}
            </StatusBadge>
          </div>
          <p className="text-sm text-text-secondary mt-1 font-mono">
            {run.event_type} ·{' '}
            <Link
              to={`/groups/${orgSlug}/projects/${projectSlug}/commit/${run.commit_sha}`}
              className="text-primary hover:underline"
            >
              {shortSha(run.commit_sha)}
            </Link>
            {' · '}
            {branch}
          </p>
        </div>
        <PrimaryButton
          type="button"
          disabled={rerunMutation.isPending || isRunInProgress(run)}
          onClick={() => rerunMutation.mutate()}
        >
          {rerunMutation.isPending ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <RefreshCw size={14} />
          )}
          Re-run
        </PrimaryButton>
      </div>

      {rerunMutation.isError && (
        <div className="mb-4 p-3 rounded-lg border border-red-r1/30 bg-dashboard-danger-bg text-dashboard-danger text-sm">
          {(rerunMutation.error as Error).message}
        </div>
      )}

      <CiTerminal
        className="ci-terminal--detail"
        bodyClassName="ci-terminal-body--detail"
        title="pertisk-ci"
        subtitle={`${projectSlug}@${shortSha(run.commit_sha)}`}
        actions={
          <span className="text-[10px] font-mono text-naturals-n9">
            {passed}/{run.jobs.length} jobs ok
          </span>
        }
      >
        <div className="ci-terminal-meta-bar">
          <span>
            started <strong>{formatDateTime(run.started_at ?? run.created_at)}</strong>
          </span>
          <span>
            finished <strong>{run.finished_at ? formatDateTime(run.finished_at) : '—'}</strong>
          </span>
          <span>
            event <strong>{run.event_type}</strong>
          </span>
        </div>

        <CiPrompt
          user="runner"
          host="self-hosted"
          path={`${orgSlug}/${projectSlug}`}
          command={`pipeline run --ref ${branch} --sha ${shortSha(run.commit_sha)}`}
        />

        <PipelineGraph
          className="pipeline-graph-panel--inline"
          jobs={jobsFromRun(run.jobs)}
          selectedJob={activeJob?.id ?? null}
          onJobSelect={(jobKey) => {
            const match = run.jobs.find((job) => job.id === jobKey || job.job_name === jobKey)
            if (match) selectJob(match.id)
          }}
        />

        <div className="ci-terminal-split ci-terminal-split--detail">
          <div className="ci-terminal-sidebar">
            {run.jobs.map((job) => (
              <div key={job.id}>
                <CiRunLine
                  status={job.status}
                  label={job.job_name}
                  meta={job.runs_on}
                  active={activeJob?.id === job.id && !activeStepKey}
                  onClick={() => selectJob(job.id)}
                />
                {activeJob?.id === job.id &&
                  activeSteps.map((step) => (
                    <CiRunLine
                      key={step.key}
                      nested
                      status={stepDisplayStatus(step, job.status)}
                      label={step.name}
                      meta={stepMeta(step)}
                      active={activeStepKey === step.key}
                      onClick={() => setActiveStepKey(step.key)}
                    />
                  ))}
              </div>
            ))}
          </div>

          <div className="ci-terminal-log-pane">
            {activeJob ? (
              <>
                <CiPrompt
                  user="runner"
                  host={activeJob.runs_on}
                  path={activeJob.job_name}
                  command={
                    activeStep?.run ??
                    (runningStepName ??
                      (activeJob.metrics_json
                        ? `exit ${activeJob.status === 'success' ? 0 : 1}`
                        : activeStepKey ?? 'running…'))
                  }
                />
                <CiLogViewer
                  className="ci-log-viewer--fill"
                  text={logText}
                  emptyMessage={
                    activeJob.status === 'queued' || activeJob.status === 'running'
                      ? activeStepKey
                        ? '(step running…)'
                        : '(job running…)'
                      : '(no log output)'
                  }
                />
                {activeJob.metrics_json && (
                  <div className="ci-terminal-meta-bar ci-terminal-meta-bar--footer">
                    <span>
                      queue <strong>{activeJob.metrics_json.queue_wait_ms}ms</strong>
                    </span>
                    <span>
                      execute <strong>{activeJob.metrics_json.execution_ms}ms</strong>
                    </span>
                    <span>
                      total <strong>{activeJob.metrics_json.total_ms}ms</strong>
                    </span>
                    <span>
                      steps <strong>{activeJob.metrics_json.steps.length}</strong>
                    </span>
                  </div>
                )}
                {activeJob.artifacts?.length > 0 && (
                  <div className="ci-artifacts-panel">
                    <h4 className="ci-artifacts-title">Artifacts</h4>
                    <ul className="ci-artifacts-list">
                      {activeJob.artifacts.map((artifact) => (
                        <li key={artifact.id} className="ci-artifacts-item">
                          <span className="ci-artifacts-name">{artifact.name}</span>
                          <span className="ci-artifacts-meta">
                            {formatBytes(artifact.size_bytes)}
                          </span>
                          <button
                            type="button"
                            className="ci-artifacts-download"
                            disabled={downloadingArtifactId === artifact.id}
                            onClick={async () => {
                              if (!token) return
                              setDownloadingArtifactId(artifact.id)
                              try {
                                await api.downloadPipelineArtifact(
                                  token,
                                  orgSlug,
                                  projectSlug,
                                  runId,
                                  artifact.id,
                                  `${artifact.name}.tar.gz`,
                                )
                              } catch (err) {
                                console.error(err)
                              } finally {
                                setDownloadingArtifactId(null)
                              }
                            }}
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
              </>
            ) : (
              <CiLogViewer text="" emptyMessage="(no jobs in this run)" />
            )}
          </div>
        </div>
      </CiTerminal>
    </div>
  )
}
