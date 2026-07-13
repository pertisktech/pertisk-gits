import type { JobRun, PipelineRun } from '../api/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Download, Loader2, Play, RotateCcw, Square, Trash2, Workflow } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { useProjectParams } from '../hooks/useProjectParams'
import { useProjectSubRoute } from '../hooks/useProjectSubRoute'
import { RepoDetailTabs } from '../components/RepoDetailTabs'
import { PipelineGraph, jobsFromRun } from '../components/PipelineGraph'
import {
  CiLogViewer,
  CiPrompt,
  CiRunLine,
  CiTerminal,
} from '../components/PipelineTerminal'
import {
  filterRunJobsForList,
  filterRunJobsForManualDeploy,
} from '../lib/pipelineSummary'
import { ConfirmModal } from '../components/ConfirmModal'
import {
  canRerunFailed,
  canRerunJob,
  canPlayManualJob,
  countRerunnableFailedJobs,
  displayJobStatus,
  displayRunStatus,
  formatPipelineIid,
  isRunInProgress,
  blocksPipelineRerun,
  refLabel,
  runStatusVariant,
  shortSha,
  type RerunScope,
} from '../lib/pipelineStatus'
import { PipelineRerunMenu } from '../components/PipelineRerunMenu'
import { StatusBadge } from '../components/StatusBadge'
import { projectTabPath } from '../lib/projectRoute'
import { projectBreadcrumbItems } from '../lib/groupRoute'
import { displayRepoName } from '../lib/projectInitial'
import { formatDateTime } from '../lib/collaboration'
import { Breadcrumbs, SecondaryButton } from '../components/ui'
import {
  inferRunningStepName,
  initialStepKey,
  jobStepViews,
  stepDisplayStatus,
  stepLogText,
  stepMeta,
} from '../lib/pipelineLog'

type PipelineDetailTab = 'pipeline' | 'jobs'

function parsePipelineTab(value: string | null): PipelineDetailTab {
  if (value === 'jobs') return 'jobs'
  return 'pipeline'
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
}

export function PipelineRunDetailPage() {
  const { orgSlug, projectSlug } = useProjectParams()
  const projectSub = useProjectSubRoute()
  const runId = projectSub?.kind === 'pipeline' ? projectSub.runId : ''
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { token } = useAuth()
  const queryClient = useQueryClient()
  const [activeJobId, setActiveJobId] = useState<string | null>(null)
  const [activeStepKey, setActiveStepKey] = useState<string | null>(null)
  const [jobLogSession, setJobLogSession] = useState(0)
  const userPinnedStep = useRef(false)
  const [downloadingArtifactId, setDownloadingArtifactId] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const activeTab = parsePipelineTab(searchParams.get('view'))

  function setActiveTab(tab: PipelineDetailTab) {
    const next = new URLSearchParams(searchParams)
    if (tab === 'pipeline') next.delete('view')
    else next.set('view', tab)
    setSearchParams(next, { replace: true })
  }

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

  const visibleJobs = useMemo(() => {
    if (!run) return []
    if (run.event_type === 'manual' && run.target_environment) {
      return filterRunJobsForManualDeploy(run)
    }
    return filterRunJobsForList(run)
  }, [run])

  const graphJobs = useMemo(() => {
    if (!run) return []
    return jobsFromRun(visibleJobs, run.status)
  }, [run, visibleJobs])

  const activeJob = useMemo(() => {
    if (!run || visibleJobs.length === 0) return null
    if (activeJobId) {
      return visibleJobs.find((job) => job.id === activeJobId) ?? visibleJobs[0] ?? null
    }
    return visibleJobs[0] ?? null
  }, [run, visibleJobs, activeJobId])

  useEffect(() => {
    if (!activeJobId || !run) return
    if (!visibleJobs.some((job) => job.id === activeJobId)) {
      setActiveJobId(null)
    }
  }, [activeJobId, visibleJobs, run])

  const activeSteps = useMemo(
    () => (activeJob && run ? jobStepViews(activeJob, run.status) : []),
    [activeJob, run],
  )

  const refreshJobLogView = (updatedRun: PipelineRun, jobId: string) => {
    const job = updatedRun.jobs.find((entry) => entry.id === jobId)
    if (!job) return
    userPinnedStep.current = false
    setActiveJobId(jobId)
    setJobLogSession((session) => session + 1)
    const step =
      initialStepKey(job, updatedRun.status) ??
      jobStepViews(job, updatedRun.status)[0]?.key ??
      null
    setActiveStepKey(step)
    setActiveTab('jobs')
  }

  useEffect(() => {
    if (!activeJob || !run || userPinnedStep.current || activeStepKey !== null) return
    const next = initialStepKey(activeJob, run.status)
    if (next) setActiveStepKey(next)
  }, [activeJob, run, activeStepKey])

  useEffect(() => {
    if (!activeJob || !run) return
    if (displayJobStatus(activeJob, run.status) !== 'running') return
    const running = inferRunningStepName(activeJob, run.status)
    if (running && running !== activeStepKey) {
      setActiveStepKey(running)
    }
  }, [activeJob, activeJob?.log_text, run, activeStepKey])

  const selectJob = (jobId: string, switchToJobs = true) => {
    if (!run) return
    const job = run.jobs.find((entry) => entry.id === jobId)
    if (!job) return
    userPinnedStep.current = false
    setActiveJobId(jobId)
    setJobLogSession((session) => session + 1)
    setActiveStepKey(
      initialStepKey(job, run.status) ??
        jobStepViews(job, run.status)[0]?.key ??
        null,
    )
    if (switchToJobs) setActiveTab('jobs')
  }

  const selectStep = (stepKey: string) => {
    userPinnedStep.current = true
    setActiveStepKey((prev) => (prev === stepKey ? null : stepKey))
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
      queryClient.invalidateQueries({
        queryKey: ['pipeline-runs', orgSlug, projectSlug],
        refetchType: 'none',
      })
      const jobId = activeJobId ?? updatedRun.jobs[0]?.id
      if (jobId) refreshJobLogView(updatedRun, jobId)
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

  const [playingJobId, setPlayingJobId] = useState<string | null>(null)
  const [rerunningJobId, setRerunningJobId] = useState<string | null>(null)

  const playJobMutation = useMutation({
    mutationFn: (jobId: string) =>
      api.playManualJob(token!, orgSlug, projectSlug, runId, jobId),
    onMutate: (jobId) => {
      setPlayingJobId(jobId)
    },
    onSettled: () => {
      setPlayingJobId(null)
    },
    onSuccess: (updatedRun, jobId) => {
      queryClient.setQueryData(['pipeline-run', orgSlug, projectSlug, runId], updatedRun)
      queryClient.invalidateQueries({
        queryKey: ['pipeline-runs', orgSlug, projectSlug],
        refetchType: 'none',
      })
      refreshJobLogView(updatedRun, jobId)
    },
  })

  const rerunJobMutation = useMutation({
    mutationFn: (jobId: string) =>
      api.rerunJob(token!, orgSlug, projectSlug, runId, jobId),
    onMutate: (jobId) => {
      setRerunningJobId(jobId)
    },
    onSettled: () => {
      setRerunningJobId(null)
    },
    onSuccess: (updatedRun, jobId) => {
      queryClient.setQueryData(['pipeline-run', orgSlug, projectSlug, runId], updatedRun)
      queryClient.invalidateQueries({
        queryKey: ['pipeline-runs', orgSlug, projectSlug],
        refetchType: 'none',
      })
      refreshJobLogView(updatedRun, jobId)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => api.deletePipeline(token!, orgSlug, projectSlug, runId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pipeline-runs', orgSlug, projectSlug] })
      navigate(projectTabPath(`/groups/${orgSlug}/projects/${projectSlug}`, 'pipelines'))
    },
  })

  const repo = repoData?.repository
  const repoName = repo ? displayRepoName(repo.name, repo.slug) : projectSlug

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

  const branch = refLabel(run.ref_name)
  const runStatus = displayRunStatus(run)
  const passed = visibleJobs.filter((job) => displayJobStatus(job, run.status) === 'success').length
  const canPlayJob = (job: JobRun) => canPlayManualJob(job, run)
  const canRerunSingleJob = (job: JobRun) => canRerunJob(job, run)

  const resolveJobKey = (jobKey: string) =>
    visibleJobs.find((job) => job.id === jobKey || job.job_name === jobKey)

  const repoPath = `/groups/${orgSlug}/projects/${projectSlug}`
  const pipelinesPath = projectTabPath(repoPath, 'pipelines')

  const detailTabs = [
    { id: 'pipeline', label: 'Pipeline' },
    { id: 'jobs', label: `Jobs (${visibleJobs.length})` },
  ]

  return (
    <div className="pipeline-run-page">
      <Breadcrumbs
        items={projectBreadcrumbItems({
          orgPath: orgSlug,
          groups,
          projectName: repoName,
          projectTo: pipelinesPath,
          suffix: [{ label: formatPipelineIid(run.pipeline_iid) }],
        })}
      />

      <div className="app-panel mb-4">
        <div className="app-panel-body space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0 flex-1">
              <Workflow size={20} className="text-primary shrink-0 mt-1" />
              <div className="min-w-0 flex-1">
                <Link
                  to={pipelinesPath}
                  className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-primary mb-2"
                >
                  <ArrowLeft size={14} />
                  Back to pipelines
                </Link>
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-xl font-semibold text-text font-mono">
                    {formatPipelineIid(run.pipeline_iid)}
                  </h1>
                  <StatusBadge variant={runStatusVariant(runStatus)}>{runStatus}</StatusBadge>
                </div>
                <p className="text-sm text-text-secondary mt-1">
                  <span className="capitalize">{run.event_type}</span>
                  {' · '}
                  <Link
                    to={`/groups/${orgSlug}/projects/${projectSlug}/commit/${run.commit_sha}`}
                    className="text-primary hover:underline font-mono"
                  >
                    {shortSha(run.commit_sha)}
                  </Link>
                  {' · '}
                  <span className="font-mono">{branch}</span>
                  {run.target_environment && (
                    <>
                      {' · '}
                      <span className="font-mono">{run.target_environment}</span>
                    </>
                  )}
                </p>
              </div>
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
                disabled={blocksPipelineRerun(run)}
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
              <strong className="text-text font-mono">{formatPipelineIid(run.pipeline_iid)}</strong>.
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
        playJobMutation.isError ||
        rerunJobMutation.isError ||
        deleteMutation.isError) && (
        <div className="p-3 rounded-lg border border-red-r1/30 bg-dashboard-danger-bg text-dashboard-danger text-sm">
          {(
            (rerunMutation.error ??
              cancelPipelineMutation.error ??
              cancelStepMutation.error ??
              playJobMutation.error ??
              rerunJobMutation.error ??
              deleteMutation.error) as Error
          ).message}
        </div>
      )}

      <div className="app-panel">
        <RepoDetailTabs
          tabs={detailTabs}
          active={activeTab}
          onChange={(id) => setActiveTab(id as PipelineDetailTab)}
        />

        {activeTab === 'pipeline' ? (
          <div className="app-panel-body flush">
            <div className="ci-terminal-meta-bar">
              <span>
                Started <strong>{formatDateTime(run.started_at ?? run.created_at)}</strong>
              </span>
              <span>
                Finished <strong>{run.finished_at ? formatDateTime(run.finished_at) : '—'}</strong>
              </span>
              <span>
                Jobs <strong>{passed}/{visibleJobs.length} passed</strong>
              </span>
            </div>
            <PipelineGraph
              className="pipeline-graph-panel--inline"
              jobs={graphJobs}
              selectedJob={activeJob?.id ?? null}
              onJobSelect={(jobKey) => {
                const match = resolveJobKey(jobKey)
                if (match) selectJob(match.id)
              }}
            />
          </div>
        ) : (
          <CiTerminal
            className="ci-terminal--detail"
            bodyClassName="ci-terminal-body--detail"
            title="pertisk-ci"
            subtitle={`${projectSlug}@${shortSha(run.commit_sha)}`}
            actions={
              <span className="text-[10px] font-mono text-naturals-n9">
                {passed}/{visibleJobs.length} jobs ok
              </span>
            }
          >
            <div className="ci-terminal-split ci-terminal-split--detail">
              <div className="ci-terminal-sidebar">
                {visibleJobs.map((job) => (
                  <div key={job.id}>
                    <CiRunLine
                      status={displayJobStatus(job, run.status)}
                      label={job.job_name}
                      meta={job.runs_on}
                      active={activeJob?.id === job.id && !activeStepKey}
                      onClick={() => selectJob(job.id, false)}
                    />
                    {activeJob?.id === job.id &&
                      activeSteps.map((step) => (
                        <CiRunLine
                          key={step.key}
                          nested
                          status={stepDisplayStatus(
                            step,
                            displayJobStatus(job, run.status),
                            run.status,
                          )}
                          label={step.name}
                          meta={stepMeta(step)}
                          active={activeStepKey === step.key}
                          onClick={() => selectStep(step.key)}
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
                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        {canRerunSingleJob(activeJob) && (
                          <SecondaryButton
                            type="button"
                            className="text-xs py-1 px-2.5"
                            disabled={rerunningJobId === activeJob.id}
                            onClick={() => rerunJobMutation.mutate(activeJob.id)}
                          >
                            {rerunningJobId === activeJob.id ? (
                              <Loader2 size={12} className="animate-spin" />
                            ) : (
                              <RotateCcw size={12} />
                            )}
                            Re-run job
                          </SecondaryButton>
                        )}
                        {canPlayJob(activeJob) && (
                          <SecondaryButton
                            type="button"
                            className="text-xs py-1 px-2.5"
                            disabled={playingJobId === activeJob.id}
                            onClick={() => playJobMutation.mutate(activeJob.id)}
                          >
                            {playingJobId === activeJob.id ? (
                              <Loader2 size={12} className="animate-spin" />
                            ) : (
                              <Play size={12} />
                            )}
                            Run job
                          </SecondaryButton>
                        )}
                        {canCancelStep && (
                          <SecondaryButton
                            type="button"
                            className="border-red-r1/40 text-dashboard-danger hover:bg-dashboard-danger-bg text-xs py-1 px-2.5"
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
                    </div>
                    <CiLogViewer
                      key={`${activeJob.id}-${jobLogSession}`}
                      className="ci-log-viewer--fill"
                      text={logText}
                      followTail
                      emptyMessage={
                        activeJobDisplayStatus === 'manual'
                          ? canPlayJob(activeJob)
                            ? 'Manual job — click Run job to start'
                            : 'Manual job — waiting for upstream jobs to finish'
                          : activeJobDisplayStatus === 'queued' || activeJobDisplayStatus === 'running'
                            ? activeStepKey
                              ? 'Waiting for log output…'
                              : 'Select a step to view logs'
                            : activeJobDisplayStatus === 'cancelled'
                              ? 'Job was cancelled'
                              : 'No log output'
                      }
                    />
                    {activeJob.metrics_json && (
                      <div className="ci-terminal-meta-bar ci-terminal-meta-bar--footer">
                        <span>
                          Queue <strong>{activeJob.metrics_json.queue_wait_ms}ms</strong>
                        </span>
                        <span>
                          Execute <strong>{activeJob.metrics_json.execution_ms}ms</strong>
                        </span>
                        <span>
                          Total <strong>{activeJob.metrics_json.total_ms}ms</strong>
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
                  <CiLogViewer text="" emptyMessage="No jobs in this pipeline run." />
                )}
              </div>
            </div>
          </CiTerminal>
        )}
      </div>
    </div>
  )
}
