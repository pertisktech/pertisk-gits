import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Download, Loader2, Square, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import {
  CiLogViewer,
  CiPrompt,
  CiRunLine,
  CiTerminal,
} from '../components/PipelineTerminal'
import { PipelineGraph, jobsFromRun } from '../components/PipelineGraph'
import { ConfirmModal } from '../components/ConfirmModal'
import {
  canRerunFailed,
  countRerunnableFailedJobs,
  displayJobStatus,
  displayRunStatus,
  isRunInProgress,
  refLabel,
  shortSha,
  type RerunScope,
} from '../lib/pipelineStatus'
import { PipelineRerunMenu } from '../components/PipelineRerunMenu'
import { PipelineRunStatusBadge } from '../components/PipelineStatus'
import { projectTabPath } from '../lib/projectRoute'
import { Breadcrumbs, SecondaryButton } from '../components/ui'
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
  const navigate = useNavigate()
  const { token } = useAuth()
  const queryClient = useQueryClient()
  const [activeJobId, setActiveJobId] = useState<string | null>(null)
  const [activeStepKey, setActiveStepKey] = useState<string | null>(null)
  const [downloadingArtifactId, setDownloadingArtifactId] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const { data: repoData } = useQuery({
    queryKey: ['repository', orgSlug, projectSlug, token ?? 'public'],
    queryFn: () => api.getRepository(orgSlug, projectSlug, token),
    enabled: Boolean(orgSlug && projectSlug),
  })

  const { data: groups = [] } = useQuery({
    queryKey: ['organizations'],
    queryFn: () => api.listOrganizations(token!),
    enabled: Boolean(token),
  })
  const group = groups.find((g) => g.slug === orgSlug)

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
    () => (activeJob && run ? jobStepViews(activeJob, run.status) : []),
    [activeJob, run],
  )

  useEffect(() => {
    setActiveStepKey(null)
  }, [activeJob?.id])

  useEffect(() => {
    if (!activeJob || !run || displayJobStatus(activeJob, run.status) !== 'running') return
    const running = inferRunningStepName(activeJob, run.status)
    if (running && running !== activeStepKey) {
      setActiveStepKey(running)
    }
  }, [activeJob, activeStepKey, run])

  const selectJob = (jobId: string) => {
    setActiveJobId(jobId)
    setActiveStepKey(null)
  }

  const logText = activeJob && run ? stepLogText(activeJob, activeStepKey, run.status) : ''
  const activeStep = activeSteps.find((step) => step.key === activeStepKey) ?? null
  const activeJobDisplayStatus = activeJob && run ? displayJobStatus(activeJob, run.status) : null
  const runningStepName =
    activeJob && activeJobDisplayStatus === 'running'
      ? inferRunningStepName(activeJob, run?.status)
      : null
  const canCancelStep =
    Boolean(activeJobDisplayStatus === 'running' && (activeStep?.running || runningStepName))
  const cancelStepName = activeStep?.running ? activeStep.name : runningStepName ?? undefined

  const rerunMutation = useMutation({
    mutationFn: (scope: RerunScope) =>
      api.rerunPipeline(token!, orgSlug, projectSlug, runId, scope),
    onSuccess: (updatedRun) => {
      queryClient.setQueryData(['pipeline-run', orgSlug, projectSlug, runId], updatedRun)
      queryClient.invalidateQueries({ queryKey: ['pipeline-runs', orgSlug, projectSlug] })
      setActiveJobId(null)
      setActiveStepKey(null)
    },
  })

  const cancelPipelineMutation = useMutation({
    mutationFn: () => api.cancelPipeline(token!, orgSlug, projectSlug, runId),
    onSuccess: (updatedRun) => {
      queryClient.setQueryData(['pipeline-run', orgSlug, projectSlug, runId], updatedRun)
      queryClient.invalidateQueries({ queryKey: ['pipeline-runs', orgSlug, projectSlug] })
    },
  })

  const cancelStepMutation = useMutation({
    mutationFn: (payload: { jobId: string; stepName?: string }) =>
      api.cancelJobStep(
        token!,
        orgSlug,
        projectSlug,
        runId,
        payload.jobId,
        payload.stepName,
      ),
    onSuccess: (updatedRun) => {
      queryClient.setQueryData(['pipeline-run', orgSlug, projectSlug, runId], updatedRun)
      queryClient.invalidateQueries({ queryKey: ['pipeline-runs', orgSlug, projectSlug] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => api.deletePipeline(token!, orgSlug, projectSlug, runId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pipeline-runs', orgSlug, projectSlug] })
      navigate(projectTabPath(`/groups/${orgSlug}/projects/${projectSlug}`, 'pipelines'))
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
          { label: 'Groups', to: '/groups' },
          { label: group?.name ?? orgSlug, to: `/groups/${orgSlug}` },
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
            <PipelineRunStatusBadge status={displayRunStatus(run)} />
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
        <div className="flex flex-wrap items-center gap-2">
          {isRunInProgress(run) && (
            <SecondaryButton
              type="button"
              className="border-red-r1/40 text-dashboard-danger hover:bg-dashboard-danger-bg"
              disabled={cancelPipelineMutation.isPending}
              onClick={() => cancelPipelineMutation.mutate()}
            >
              {cancelPipelineMutation.isPending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Square size={14} />
              )}
              Cancel pipeline
            </SecondaryButton>
          )}
          <PipelineRerunMenu
            disabled={isRunInProgress(run)}
            loading={rerunMutation.isPending}
            canRerunFailed={canRerunFailed(run)}
            failedCount={countRerunnableFailedJobs(run)}
            onRerun={(scope) => rerunMutation.mutate(scope)}
          />
          {!isRunInProgress(run) && (
            <SecondaryButton
              type="button"
              className="border-red-r1/40 text-dashboard-danger hover:bg-dashboard-danger-bg"
              disabled={deleteMutation.isPending}
              onClick={() => setConfirmDelete(true)}
            >
              {deleteMutation.isPending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Trash2 size={14} />
              )}
              Delete
            </SecondaryButton>
          )}
        </div>
      </div>

      {confirmDelete && (
        <ConfirmModal
          open
          variant="danger"
          title="Delete pipeline run?"
          description={
            <>
              This removes the run, job logs, and any uploaded artifacts for{' '}
              <strong className="text-text font-mono">{shortSha(run.commit_sha)}</strong>.
            </>
          }
          confirmLabel="Delete run"
          loading={deleteMutation.isPending}
          onConfirm={() => deleteMutation.mutate()}
          onCancel={() => setConfirmDelete(false)}
        />
      )}

      {(rerunMutation.isError ||
        cancelPipelineMutation.isError ||
        cancelStepMutation.isError ||
        deleteMutation.isError) && (
        <div className="mb-4 p-3 rounded-lg border border-red-r1/30 bg-dashboard-danger-bg text-dashboard-danger text-sm">
          {(
            (rerunMutation.error ??
              cancelPipelineMutation.error ??
              cancelStepMutation.error ??
              deleteMutation.error) as Error
          ).message}
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
          host="pertisk-ci"
          path={`${orgSlug}/${projectSlug}`}
          command={`pipeline run --ref ${branch} --sha ${shortSha(run.commit_sha)}`}
        />

        <PipelineGraph
          className="pipeline-graph-panel--inline"
          jobs={jobsFromRun(run.jobs, run.status)}
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
                  status={displayJobStatus(job, run.status)}
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
                      status={stepDisplayStatus(step, displayJobStatus(job, run.status), run.status)}
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
                <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-naturals-n4/40">
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
                  {canCancelStep && (
                    <SecondaryButton
                      type="button"
                      className="shrink-0 border-red-r1/40 text-dashboard-danger hover:bg-dashboard-danger-bg text-xs py-1 px-2.5"
                      disabled={cancelStepMutation.isPending}
                      onClick={() =>
                        cancelStepMutation.mutate({
                          jobId: activeJob.id,
                          stepName: cancelStepName,
                        })
                      }
                    >
                      {cancelStepMutation.isPending ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <Square size={12} />
                      )}
                      Cancel step
                    </SecondaryButton>
                  )}
                </div>
                <CiLogViewer
                  className="ci-log-viewer--fill"
                  text={logText}
                  emptyMessage={
                    activeJobDisplayStatus === 'queued' || activeJobDisplayStatus === 'running'
                      ? activeStepKey
                        ? '(step running…)'
                        : '(job running…)'
                      : activeJobDisplayStatus === 'cancelled'
                        ? '(cancelled)'
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
