import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Download, Loader2, Square, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
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
import { ActionsStatusIcon } from '../components/PipelineStatus'
import { projectTabPath } from '../lib/projectRoute'
import { Breadcrumbs, SecondaryButton } from '../components/ui'
import {
  inferRunningStepName,
  jobStepViews,
  stepLogText,
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

  const repoPath = `/groups/${orgSlug}/projects/${projectSlug}`
  const pipelinesPath = projectTabPath(repoPath, 'pipelines')

  return (
    <div className="gha-run-page">
      <Breadcrumbs
        items={[
          { label: 'Groups', to: '/groups' },
          { label: group?.name ?? orgSlug, to: `/groups/${orgSlug}` },
          { label: repoName, to: pipelinesPath },
          { label: shortSha(run.commit_sha) },
        ]}
      />

      <div className="gha-run-header">
        <div>
          <Link to={pipelinesPath} className="gha-run-back">
            <ArrowLeft size={14} />
            All workflows
          </Link>
          <div className="gha-run-title-row">
            <ActionsStatusIcon status={runStatus} size="lg" />
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
        deleteMutation.isError) && (
        <div className="p-3 rounded-lg border border-red-r1/30 bg-dashboard-danger-bg text-dashboard-danger text-sm">
          {(
            (rerunMutation.error ??
              cancelPipelineMutation.error ??
              cancelStepMutation.error ??
              deleteMutation.error) as Error
          ).message}
        </div>
      )}

      <ActionsRunSummary run={run} />

      <div className="gha-graph-panel">
        <PipelineGraph
          className="pipeline-graph-panel--inline"
          jobs={jobsFromRun(run.jobs, run.status)}
          selectedJob={activeJob?.id ?? null}
          onJobSelect={(jobKey) => {
            const match = run.jobs.find((job) => job.id === jobKey || job.job_name === jobKey)
            if (match) selectJob(match.id)
          }}
        />
      </div>

      <div className="gha-run-layout">
        <ActionsJobSidebar
          jobs={run.jobs}
          runStatus={run.status}
          activeJobId={activeJob?.id ?? null}
          onSelectJob={selectJob}
        />

        <div className="gha-run-main">
          {activeJob ? (
            <>
              <ActionsJobHeader job={activeJob} jobStatus={displayJobStatus(activeJob, run.status)} />

              <ActionsStepList
                steps={activeSteps}
                jobStatus={displayJobStatus(activeJob, run.status)}
                runStatus={run.status}
                activeStepKey={activeStepKey}
                onSelectStep={setActiveStepKey}
              />

              <ActionsLogPanel
                title={stepLogTitle(activeStep, activeJob.job_name)}
                subtitle={stepLogSubtitle(activeStep)}
                actions={
                  canCancelStep ? (
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
                  ) : undefined
                }
                logText={logText}
                emptyMessage={
                  activeJobDisplayStatus === 'queued' || activeJobDisplayStatus === 'running'
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
