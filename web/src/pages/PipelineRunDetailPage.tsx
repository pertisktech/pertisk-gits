import type { JobRun, PipelineRun } from '../api/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Download, Loader2, Square, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { useProjectParams } from '../hooks/useProjectParams'
import { useProjectSubRoute } from '../hooks/useProjectSubRoute'
import {
  ActionsJobHeader,
  ActionsJobSidebar,
  ActionsLogPanel,
  ActionsRunSummary,
  ActionsStepList,
  stepLogSubtitle,
  stepLogTitle,
} from '../components/PipelineActions'
import { PipelineGraph, jobsFromRun } from '../components/PipelineGraph'
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
  displayRunStatusIcon,
  isRunInProgress,
  blocksPipelineRerun,
  refLabel,
  shortSha,
  type RerunScope,
} from '../lib/pipelineStatus'
import { PipelineRerunMenu } from '../components/PipelineRerunMenu'
import { ActionsStatusIcon } from '../components/PipelineStatus'
import { projectTabPath } from '../lib/projectRoute'
import { projectBreadcrumbItems } from '../lib/groupRoute'
import { displayRepoName } from '../lib/projectInitial'
import { Breadcrumbs, SecondaryButton } from '../components/ui'
import {
  inferRunningStepName,
  initialStepKey,
  jobStepViews,
  stepLogText,
} from '../lib/pipelineLog'

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
  const { token } = useAuth()
  const queryClient = useQueryClient()
  const [activeJobId, setActiveJobId] = useState<string | null>(null)
  const [activeStepKey, setActiveStepKey] = useState<string | null>(null)
  const [jobLogSession, setJobLogSession] = useState(0)
  const userPinnedStep = useRef(false)
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
  }

  useEffect(() => {
    if (!activeJob || !run || userPinnedStep.current || activeStepKey !== null) return
    const next = initialStepKey(activeJob, run.status)
    if (next) setActiveStepKey(next)
  }, [activeJob, run, activeStepKey])

  useEffect(() => {
    if (!activeJob || !run || userPinnedStep.current) return
    if (displayJobStatus(activeJob, run.status) !== 'running') return
    const running = inferRunningStepName(activeJob, run.status)
    if (running && running !== activeStepKey) {
      setActiveStepKey(running)
    }
  }, [activeJob, activeJob?.log_text, run, activeStepKey])

  const selectJob = (jobId: string) => {
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
        Loading workflow run…
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
  const runStatusIcon = displayRunStatusIcon(run)
  const canPlayJob = (job: JobRun) => canPlayManualJob(job, run)
  const canRerunSingleJob = (job: JobRun) => canRerunJob(job, run)

  const resolveJobKey = (jobKey: string) =>
    visibleJobs.find((job) => job.id === jobKey || job.job_name === jobKey)

  const repoPath = `/groups/${orgSlug}/projects/${projectSlug}`
  const pipelinesPath = projectTabPath(repoPath, 'pipelines')

  return (
    <div className="gha-run-page">
      <Breadcrumbs
        items={projectBreadcrumbItems({
          orgPath: orgSlug,
          groups,
          projectName: repoName,
          projectTo: pipelinesPath,
          suffix: [{ label: shortSha(run.commit_sha) }],
        })}
      />

      <div className="gha-run-header">
        <div>
          <Link to={pipelinesPath} className="gha-run-back">
            <ArrowLeft size={14} />
            All workflows
          </Link>
          <div className="gha-run-title-row">
            <ActionsStatusIcon status={runStatusIcon} size="lg" />
            <h1 className="gha-run-title">
              <span className="font-mono">.pertisk-ci.yaml</span>
            </h1>
          </div>
          <p className="gha-run-subtitle">
            <Link
              to={`/groups/${orgSlug}/projects/${projectSlug}/commit/${run.commit_sha}`}
              className="text-primary hover:underline font-mono"
            >
              {shortSha(run.commit_sha)}
            </Link>
            {' · '}
            {branch}
            {' · '}
            {run.event_type}
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
              Cancel workflow
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

      {confirmDelete && (
        <ConfirmModal
          open
          variant="danger"
          title="Delete workflow run?"
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

      <ActionsRunSummary run={run} />

      <div className="gha-graph-panel">
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

      <div className="gha-run-layout">
        <ActionsJobSidebar
          jobs={visibleJobs}
          runStatus={runStatus}
          activeJobId={activeJob?.id ?? null}
          onSelectJob={selectJob}
        />

        <div className="gha-run-main">
          {activeJob ? (
            <>
              <ActionsJobHeader
                job={activeJob}
                jobStatus={displayJobStatus(activeJob, runStatus)}
                canPlay={canPlayJob(activeJob)}
                playPending={playingJobId === activeJob.id}
                onPlay={() => playJobMutation.mutate(activeJob.id)}
                canRerun={canRerunSingleJob(activeJob)}
                rerunPending={rerunningJobId === activeJob.id}
                onRerun={() => rerunJobMutation.mutate(activeJob.id)}
              />

              <ActionsStepList
                steps={activeSteps}
                jobStatus={displayJobStatus(activeJob, runStatus)}
                runStatus={runStatus}
                activeStepKey={activeStepKey}
                onSelectStep={selectStep}
              />

              <ActionsLogPanel
                title={activeStep ? stepLogTitle(activeStep, activeJob.job_name) : activeJob.job_name}
                subtitle={activeStep ? stepLogSubtitle(activeStep) : undefined}
                viewerKey={`${activeJob.id}-${jobLogSession}-${activeStepKey ?? ''}`}
                actions={
                  canCancelStep ? (
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
                  ) : undefined
                }
                logText={logText}
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
                footer={
                  <>
                    {activeJob.metrics_json && (
                      <div className="gha-metrics-bar">
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
                      <div className="gha-artifacts">
                        <h4 className="gha-artifacts-title">Artifacts</h4>
                        <ul className="gha-artifacts-list">
                          {activeJob.artifacts.map((artifact) => (
                            <li key={artifact.id} className="gha-artifacts-item">
                              <span className="gha-artifacts-name">{artifact.name}</span>
                              <span className="gha-artifacts-meta">
                                {formatBytes(artifact.size_bytes)}
                              </span>
                              <button
                                type="button"
                                className="gha-artifacts-download"
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
                                  <Loader2 className="animate-spin" size={14} />
                                ) : (
                                  <Download size={14} />
                                )}
                                Download
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </>
                }
              />
            </>
          ) : (
            <div className="gha-run-empty">No jobs in this workflow run.</div>
          )}
        </div>
      </div>
    </div>
  )
}
