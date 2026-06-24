import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Loader2, RefreshCw, Workflow } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api/client'
import type { JobRun, PipelineRun } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { pipelineUrl, refLabel, runStatusVariant, shortSha } from '../components/RepoPipelines'
import { StatusBadge } from '../components/StatusBadge'
import { Breadcrumbs, PrimaryButton } from '../components/ui'
import { formatDateTime } from '../lib/collaboration'
import { cn } from '../utils/cn'

function jobStatusVariant(status: JobRun['status']) {
  if (status === 'success') return 'green' as const
  if (status === 'failure') return 'red' as const
  if (status === 'running' || status === 'queued') return 'yellow' as const
  return 'gray' as const
}

function JobMetricsPanel({ metrics }: { metrics: JobRun['metrics_json'] }) {
  if (!metrics) return null
  return (
    <div className="text-xs text-text-secondary grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2">
      <div>Queue: {metrics.queue_wait_ms}ms</div>
      <div>Execute: {metrics.execution_ms}ms</div>
      <div>Total: {metrics.total_ms}ms</div>
      <div>Steps: {metrics.steps.length}</div>
    </div>
  )
}

export function PipelineRunDetailPage() {
  const { slug: orgSlug = '', projectSlug = '', runId = '' } = useParams()
  const { token } = useAuth()
  const queryClient = useQueryClient()

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
      return item.status === 'running' || item.status === 'queued' || item.status === 'pending'
        ? 4000
        : false
    },
  })

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

  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Repositories', to: '/groups' },
          { label: repoName, to: `/groups/${orgSlug}/projects/${projectSlug}?tab=pipelines` },
          { label: `Pipeline ${shortSha(run.commit_sha)}` },
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
          <h1 className="text-xl font-semibold text-text flex items-center gap-2">
            <Workflow size={20} />
            Pipeline run
          </h1>
          <p className="text-sm text-text-secondary mt-1 flex flex-wrap items-center gap-2">
            <StatusBadge variant={runStatusVariant(run.status)}>{run.status}</StatusBadge>
            <span>·</span>
            <Link
              to={`/groups/${orgSlug}/projects/${projectSlug}/commit/${run.commit_sha}`}
              className="font-mono hover:text-primary"
            >
              {shortSha(run.commit_sha)}
            </Link>
            <span>·</span>
            <span>{refLabel(run.ref_name)}</span>
            <span>·</span>
            <span>{run.event_type}</span>
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

      <RunSummary run={run} />

      <div className="space-y-4 mt-4">
        {run.jobs.map((job) => (
          <JobCard key={job.id} job={job} />
        ))}
      </div>
    </>
  )
}

function RunSummary({ run }: { run: PipelineRun }) {
  return (
    <div className="gogs-panel p-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
      <div>
        <div className="text-text-secondary text-xs">Created</div>
        <div>{formatDateTime(run.created_at)}</div>
      </div>
      <div>
        <div className="text-text-secondary text-xs">Started</div>
        <div>{run.started_at ? formatDateTime(run.started_at) : '—'}</div>
      </div>
      <div>
        <div className="text-text-secondary text-xs">Finished</div>
        <div>{run.finished_at ? formatDateTime(run.finished_at) : '—'}</div>
      </div>
      <div>
        <div className="text-text-secondary text-xs">Jobs</div>
        <div>
          {run.jobs.filter((j) => j.status === 'success').length}/{run.jobs.length} passed
        </div>
      </div>
    </div>
  )
}

function JobCard({ job }: { job: JobRun }) {
  const [open, setOpen] = useState(true)
  return (
    <div className="gogs-panel overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center justify-between gap-3 p-4 text-left hover:bg-hover/40"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="min-w-0">
          <div className="font-medium text-text">{job.job_name}</div>
          <JobMetricsPanel metrics={job.metrics_json} />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <StatusBadge variant={jobStatusVariant(job.status)}>{job.status}</StatusBadge>
          <span className="text-xs text-text-secondary">{job.runs_on}</span>
        </div>
      </button>
      {open && (
        <div className="border-t border-border">
          <pre
            className={cn(
              'p-4 text-xs font-mono overflow-x-auto max-h-[28rem] overflow-y-auto',
              'bg-naturals-n1 text-text-secondary whitespace-pre-wrap break-words',
            )}
          >
            {job.log_text.trim() || '(no log output yet)'}
          </pre>
        </div>
      )}
    </div>
  )
}
