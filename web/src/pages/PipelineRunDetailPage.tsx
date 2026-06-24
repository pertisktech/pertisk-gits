import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Loader2, RefreshCw } from 'lucide-react'
import { useMemo, useState } from 'react'
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
import { pipelineUrl, displayRunStatus, isRunInProgress, refLabel, runStatusVariant, shortSha } from '../components/RepoPipelines'
import { StatusBadge } from '../components/StatusBadge'
import { Breadcrumbs, PrimaryButton } from '../components/ui'
import { formatDateTime } from '../lib/collaboration'

export function PipelineRunDetailPage() {
  const { slug: orgSlug = '', projectSlug = '', runId = '' } = useParams()
  const { token } = useAuth()
  const queryClient = useQueryClient()
  const [activeJobId, setActiveJobId] = useState<string | null>(null)

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
      return isRunInProgress(item) ? 4000 : false
    },
  })

  const activeJob = useMemo(() => {
    if (!run) return null
    if (activeJobId) {
      return run.jobs.find((job) => job.id === activeJobId) ?? run.jobs[0] ?? null
    }
    return run.jobs[0] ?? null
  }, [run, activeJobId])

  const rerunMutation = useMutation({
    mutationFn: () =>
      api.triggerPipeline(token!, orgSlug, projectSlug, {
        commit_sha: run!.commit_sha,
        ref_name: run!.ref_name,
        event_type: 'manual',
      }),
    onSuccess: (newRun) => {
      queryClient.invalidateQueries({ queryKey: ['pipeline-runs', orgSlug, projectSlug] })
      window.location.assign(pipelineUrl(orgSlug, projectSlug, newRun.id))
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

  return (
    <div className="pipeline-run-page">
      <Breadcrumbs
        items={[
          { label: 'Repositories', to: '/groups' },
          { label: repoName, to: `/groups/${orgSlug}/projects/${projectSlug}?tab=pipelines` },
          { label: `run ${shortSha(run.commit_sha)}` },
        ]}
      />

      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            to={`/groups/${orgSlug}/projects/${projectSlug}?tab=pipelines`}
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
          disabled={rerunMutation.isPending}
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
            if (match) setActiveJobId(match.id)
          }}
        />

        <div className="ci-terminal-split ci-terminal-split--detail">
          <div className="ci-terminal-sidebar">
            {run.jobs.map((job) => (
              <CiRunLine
                key={job.id}
                status={job.status}
                label={job.job_name}
                meta={job.runs_on}
                active={activeJob?.id === job.id}
                onClick={() => setActiveJobId(job.id)}
              />
            ))}
          </div>

          <div className="ci-terminal-log-pane">
            {activeJob ? (
              <>
                <CiPrompt
                  user="runner"
                  host={activeJob.runs_on}
                  path={activeJob.job_name}
                  command={activeJob.metrics_json ? `exit ${activeJob.status === 'success' ? 0 : 1}` : 'running…'}
                />
                <CiLogViewer
                  className="ci-log-viewer--fill"
                  text={activeJob.log_text}
                  emptyMessage={
                    activeJob.status === 'queued' || activeJob.status === 'running'
                      ? '(job running…)'
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
