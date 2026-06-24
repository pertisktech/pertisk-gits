import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Play, Workflow } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import type { JobRun, PipelineRun } from '../api/types'
import { StatusBadge } from './StatusBadge'
import { PrimaryButton } from './ui'
import { formatDateTime } from '../lib/collaboration'

export const PIPELINE_CONFIG_FILES = new Set([
  '.pertisk-ci.yaml',
  '.pertisk-ci.yml',
  'pertisk-ci.yaml',
  'pertisk-ci.yml',
])

function pipelineUrl(orgSlug: string, repoSlug: string, runId: string) {
  return `/groups/${orgSlug}/projects/${repoSlug}/pipelines/${runId}`
}

function runStatusVariant(status: PipelineRun['status']) {
  if (status === 'success') return 'green' as const
  if (status === 'failure') return 'red' as const
  if (status === 'running' || status === 'queued') return 'yellow' as const
  return 'gray' as const
}

function shortSha(sha: string) {
  return sha.slice(0, 7)
}

function refLabel(refName: string) {
  return refName.replace(/^refs\/heads\//, '')
}

function failureSummary(jobs: JobRun[]): string | null {
  const failed = jobs.filter((job) => job.status === 'failure')
  if (failed.length === 0) return null

  const log = failed[0].log_text.trim()
  if (!log) return `Job "${failed[0].job_name}" failed`

  const checkout = log.match(/checkout failed: (.+)/)?.[1]
  if (checkout) return checkout

  const stepFailed = log.match(/=== .+ \(exit [1-9]\d*\)/)?.[0]
  if (stepFailed) return stepFailed.replace(/^=== /, '')

  const line = log.split('\n').find((entry) => entry.trim() && !entry.startsWith('==='))
  return line?.trim().slice(0, 160) ?? `Job "${failed[0].job_name}" failed`
}

function jobNamesSummary(jobs: JobRun[]) {
  if (jobs.length === 0) return '—'
  return jobs
    .map((job) => {
      if (job.status === 'failure') return `${job.job_name} ✗`
      if (job.status === 'success') return `${job.job_name} ✓`
      return job.job_name
    })
    .join(', ')
}

export function RepoPipelines({
  token,
  orgSlug,
  repoSlug,
  defaultBranch,
}: {
  token: string
  orgSlug: string
  repoSlug: string
  defaultBranch: string
}) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const { data: runs = [], isLoading, error } = useQuery({
    queryKey: ['pipeline-runs', orgSlug, repoSlug],
    queryFn: () => api.listPipelineRuns(token, orgSlug, repoSlug),
    enabled: Boolean(orgSlug && repoSlug && token),
    refetchInterval: (query) => {
      const items = query.state.data ?? []
      return items.some((r) => r.status === 'running' || r.status === 'queued' || r.status === 'pending')
        ? 5000
        : false
    },
  })

  const triggerMutation = useMutation({
    mutationFn: async () => {
      const commits = await api.getRepoCommits(orgSlug, repoSlug, { ref: defaultBranch, limit: 1 }, token)
      const head = commits.commits[0]
      if (!head) throw new Error('No commits on default branch')
      return api.triggerPipeline(token, orgSlug, repoSlug, {
        commit_sha: head.sha,
        ref_name: `refs/heads/${defaultBranch}`,
        event_type: 'manual',
      })
    },
    onSuccess: (newRun) => {
      queryClient.invalidateQueries({ queryKey: ['pipeline-runs', orgSlug, repoSlug] })
      navigate(pipelineUrl(orgSlug, repoSlug, newRun.id))
    },
  })

  if (isLoading) {
    return (
      <div className="gogs-panel">
        <div className="gogs-panel-body flex items-center gap-2 text-text-secondary text-sm p-6">
          <Loader2 size={16} className="animate-spin" />
          Loading pipelines…
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="gogs-panel">
        <div className="gogs-panel-body p-4 text-sm text-dashboard-danger">
          {(error as Error).message}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-text flex items-center gap-2">
            <Workflow size={18} />
            Pipelines
          </h2>
          <p className="text-sm text-text-secondary mt-0.5">
            CI runs from <code className="text-xs">.pertisk-ci.yaml</code>
          </p>
        </div>
        <PrimaryButton
          type="button"
          disabled={triggerMutation.isPending}
          onClick={() => triggerMutation.mutate()}
        >
          {triggerMutation.isPending ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Play size={14} />
          )}
          Run pipeline
        </PrimaryButton>
      </div>

      {triggerMutation.isError && (
        <div className="p-3 rounded-lg border border-red-r1/30 bg-dashboard-danger-bg text-dashboard-danger text-sm">
          {(triggerMutation.error as Error).message}
        </div>
      )}

      <div className="gogs-panel">
        <div className="gogs-toolbar">
          <span className="text-xs text-text-secondary">
            {runs.length} run{runs.length === 1 ? '' : 's'}
          </span>
        </div>

        {runs.length === 0 ? (
          <div className="gogs-panel-body text-center py-12 text-text-secondary text-sm">
            No pipeline runs yet. Add <code>.pertisk-ci.yaml</code> and push, or click Run pipeline.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {runs.map((run) => (
              <PipelineRow
                key={run.id}
                run={run}
                orgSlug={orgSlug}
                repoSlug={repoSlug}
                onOpen={() => navigate(pipelineUrl(orgSlug, repoSlug, run.id))}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function PipelineRow({
  run,
  orgSlug,
  repoSlug,
  onOpen,
}: {
  run: PipelineRun
  orgSlug: string
  repoSlug: string
  onOpen: () => void
}) {
  const passed = run.jobs.filter((j) => j.status === 'success').length
  const failed = run.jobs.filter((j) => j.status === 'failure').length
  const summary = failureSummary(run.jobs)
  const runUrl = pipelineUrl(orgSlug, repoSlug, run.id)

  return (
    <li>
      <div
        role="link"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onOpen()
          }
        }}
        className="flex items-start gap-3 px-4 py-3 hover:bg-hover transition-colors cursor-pointer"
      >
        <Workflow size={16} className="text-primary shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <StatusBadge variant={runStatusVariant(run.status)}>{run.status}</StatusBadge>
            <span className="text-sm text-text font-medium">{run.event_type}</span>
            <Link
              to={`/groups/${orgSlug}/projects/${repoSlug}/commit/${run.commit_sha}`}
              className="font-mono text-sm text-primary hover:underline"
              onClick={(event) => event.stopPropagation()}
            >
              {shortSha(run.commit_sha)}
            </Link>
            <span className="text-sm text-text-secondary">{refLabel(run.ref_name)}</span>
          </div>
          {summary && (
            <p className="text-xs text-dashboard-danger mt-1 line-clamp-2" title={summary}>
              {summary}
            </p>
          )}
          <div className="text-xs text-muted mt-1.5 flex flex-wrap gap-x-2 gap-y-0.5">
            <span>{jobNamesSummary(run.jobs)}</span>
            <span>
              {passed}/{run.jobs.length} passed
              {failed > 0 && <span className="text-dashboard-danger"> ({failed} failed)</span>}
            </span>
            <span>{formatDateTime(run.started_at ?? run.created_at)}</span>
          </div>
        </div>
        <Link
          to={runUrl}
          className="shrink-0 text-xs text-text-secondary hover:text-primary self-center"
          onClick={(event) => event.stopPropagation()}
        >
          View
        </Link>
      </div>
    </li>
  )
}

export { pipelineUrl, runStatusVariant, shortSha, refLabel }
