import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Play } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import type { JobRun, PipelineRun } from '../api/types'
import { PipelineGraph } from './PipelineGraph'
import type { PipelineGraphJob } from '../lib/pipelineGraphLayout'
import {
  CiPrompt,
  CiRunLine,
  CiTerminal,
} from './PipelineTerminal'
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

/** UI status — pipeline_run.status can stay "running" while failed jobs exist and others are queued. */
export function displayRunStatus(run: PipelineRun): PipelineRun['status'] {
  const { jobs, status } = run
  if (jobs.length === 0) return status

  const hasRunning = jobs.some((j) => j.status === 'running')
  const hasFailed = jobs.some((j) => j.status === 'failure')
  const allTerminal = jobs.every(
    (j) => j.status === 'success' || j.status === 'failure' || j.status === 'cancelled',
  )

  if (allTerminal) {
    return hasFailed ? 'failure' : 'success'
  }

  if (hasFailed && !hasRunning) {
    return 'failure'
  }

  return status
}

export function isRunInProgress(run: PipelineRun): boolean {
  const displayStatus = displayRunStatus(run)
  return displayStatus === 'running' || displayStatus === 'queued' || displayStatus === 'pending'
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
      return items.some((r) => isRunInProgress(r)) ? 5000 : false
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
      <CiTerminal title="pertisk-ci" subtitle={repoSlug}>
        <div className="ci-log-viewer">
          <div className="ci-log-line ci-log-line-muted flex items-center gap-2">
            <Loader2 size={14} className="animate-spin" />
            Loading pipelines…
          </div>
        </div>
      </CiTerminal>
    )
  }

  if (error) {
    return (
      <CiTerminal title="pertisk-ci" subtitle={repoSlug}>
        <div className="ci-log-viewer">
          <div className="ci-log-line ci-log-line-error">{(error as Error).message}</div>
        </div>
      </CiTerminal>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-text font-mono">pipelines</h2>
          <p className="text-sm text-text-secondary mt-0.5">
            CI from <code className="text-xs font-mono">.pertisk-ci.yaml</code>
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

      <PipelineConfigGraph
        token={token}
        orgSlug={orgSlug}
        repoSlug={repoSlug}
        defaultBranch={defaultBranch}
      />

      <CiTerminal
        title="pertisk-ci"
        subtitle={`${repoSlug} — ${runs.length} run${runs.length === 1 ? '' : 's'}`}
      >
        <CiPrompt user="dev" host="pertisk-ci" path={repoSlug} command="pipeline list --recent" />

        {runs.length === 0 ? (
          <div className="ci-log-viewer">
            <div className="ci-log-line ci-log-line-muted">
              No pipeline runs yet. Add .pertisk-ci.yaml and push, or click Run pipeline.
            </div>
          </div>
        ) : (
          <div>
            {runs.map((run) => (
              <PipelineRow
                key={run.id}
                run={run}
                orgSlug={orgSlug}
                repoSlug={repoSlug}
                onOpen={() => navigate(pipelineUrl(orgSlug, repoSlug, run.id))}
              />
            ))}
          </div>
        )}
      </CiTerminal>
    </div>
  )
}

function PipelineRow({
  run,
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

  return (
    <CiRunLine
      status={displayRunStatus(run)}
      label={run.event_type}
      meta={`${shortSha(run.commit_sha)} · ${refLabel(run.ref_name)} · ${passed}/${run.jobs.length}${failed > 0 ? ` (${failed} failed)` : ''} · ${formatDateTime(run.started_at ?? run.created_at)}`}
      hint={summary ?? undefined}
      onClick={onOpen}
    />
  )
}

export { pipelineUrl, runStatusVariant, shortSha, refLabel }

function PipelineConfigGraph({
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
  const { data, isLoading, isError } = useQuery({
    queryKey: ['pipeline-config-preview', orgSlug, repoSlug, defaultBranch],
    queryFn: () => api.getPipelineConfig(token, orgSlug, repoSlug, defaultBranch),
    enabled: Boolean(token && orgSlug && repoSlug && defaultBranch),
  })

  const jobs: PipelineGraphJob[] =
    data?.jobs.map((job) => ({
      name: job.name,
      runs_on: job.runs_on,
      needs: job.needs,
      step_count: job.step_count,
    })) ?? []

  if (isError) return null

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="px-3 py-2 border-b border-border bg-surface-secondary flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-text font-mono">pipeline graph</h3>
          {data && (
            <p className="text-xs text-text-secondary font-mono mt-0.5">
              {data.config_path} @ {shortSha(data.commit_sha)} ({refLabel(data.ref)})
            </p>
          )}
        </div>
      </div>
      <PipelineGraph jobs={jobs} loading={isLoading} emptyMessage="No jobs in pipeline config" />
    </div>
  )
}
