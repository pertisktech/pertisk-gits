import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Play, Workflow } from 'lucide-react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import type { PipelineRun } from '../api/types'
import { StatusBadge } from './StatusBadge'
import { PrimaryButton } from './ui'
import { formatDateTime } from '../lib/collaboration'

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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pipeline-runs', orgSlug, repoSlug] })
    },
  })

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-text-secondary py-6">
        <Loader2 size={16} className="animate-spin" />
        Loading pipelines…
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-3 rounded-lg border border-red-r1/30 bg-dashboard-danger-bg text-dashboard-danger text-sm">
        {(error as Error).message}
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

      {runs.length === 0 ? (
        <div className="gogs-panel p-8 text-center text-sm text-text-secondary">
          No pipeline runs yet. Add <code>.pertisk-ci.yaml</code> and push, or click Run pipeline.
        </div>
      ) : (
        <div className="gogs-panel overflow-hidden">
          <table className="gogs-table w-full">
            <thead>
              <tr>
                <th>Status</th>
                <th>Workflow</th>
                <th>Commit</th>
                <th>Branch</th>
                <th>Jobs</th>
                <th>Started</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => {
                const passed = run.jobs.filter((j) => j.status === 'success').length
                const failed = run.jobs.filter((j) => j.status === 'failure').length
                return (
                  <tr key={run.id}>
                    <td>
                      <StatusBadge variant={runStatusVariant(run.status)}>{run.status}</StatusBadge>
                    </td>
                    <td>
                      <Link
                        to={pipelineUrl(orgSlug, repoSlug, run.id)}
                        className="text-primary hover:underline font-medium"
                      >
                        {run.event_type}
                      </Link>
                    </td>
                    <td>
                      <Link
                        to={`/groups/${orgSlug}/projects/${repoSlug}/commit/${run.commit_sha}`}
                        className="font-mono text-sm text-text-secondary hover:text-primary"
                      >
                        {shortSha(run.commit_sha)}
                      </Link>
                    </td>
                    <td className="text-sm text-text-secondary">{refLabel(run.ref_name)}</td>
                    <td className="text-sm text-text-secondary">
                      {passed}/{run.jobs.length} passed
                      {failed > 0 && <span className="text-dashboard-danger ml-1">({failed} failed)</span>}
                    </td>
                    <td className="text-sm text-text-secondary whitespace-nowrap">
                      {formatDateTime(run.started_at ?? run.created_at)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export { pipelineUrl, runStatusVariant, shortSha, refLabel }
