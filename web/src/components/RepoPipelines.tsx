import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Play, Workflow } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import type { PipelineGraphJob } from '../lib/pipelineGraphLayout'
import {
  isRunInProgress,
  pipelineUrl,
  refLabel,
  shortSha,
  type RerunScope,
} from '../lib/pipelineStatus'
import { PipelineGraph } from './PipelineGraph'
import { PipelineRunsTable } from './PipelineRunsTable'
import { EmptyState, PrimaryButton } from './ui'

export const PIPELINE_CONFIG_FILES = new Set([
  '.pertisk-ci.yaml',
  '.pertisk-ci.yml',
  'pertisk-ci.yaml',
  'pertisk-ci.yml',
])

export {
  displayJobStatus,
  displayRunStatus,
  isRunInProgress,
  pipelineUrl,
  refLabel,
  runStatusVariant,
  shortSha,
} from '../lib/pipelineStatus'

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

  const { data: browserData, isLoading: browserLoading } = useQuery({
    queryKey: ['repo-browser', orgSlug, repoSlug],
    queryFn: () => api.getRepoBrowser(orgSlug, repoSlug, token),
    enabled: Boolean(orgSlug && repoSlug),
  })

  const repoEmpty = browserData?.browser.empty ?? false

  const { data: hasPipelineConfig = false, isLoading: configLoading } = useQuery({
    queryKey: ['pipeline-config', orgSlug, repoSlug, defaultBranch],
    queryFn: async () => {
      const tree = await api.getRepoTree(orgSlug, repoSlug, { ref: defaultBranch }, token)
      return tree.entries.some(
        (entry) => PIPELINE_CONFIG_FILES.has(entry.name) && entry.kind === 'blob',
      )
    },
    enabled: Boolean(token && orgSlug && repoSlug && defaultBranch && browserData && !repoEmpty),
  })

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

  const [rerunningRunId, setRerunningRunId] = useState<string | null>(null)

  const rerunMutation = useMutation({
    mutationFn: ({ runId, scope }: { runId: string; scope: RerunScope }) =>
      api.rerunPipeline(token, orgSlug, repoSlug, runId, scope),
    onMutate: ({ runId }) => {
      setRerunningRunId(runId)
    },
    onSettled: () => {
      setRerunningRunId(null)
    },
    onSuccess: (updatedRun) => {
      queryClient.invalidateQueries({ queryKey: ['pipeline-runs', orgSlug, repoSlug] })
      navigate(pipelineUrl(orgSlug, repoSlug, updatedRun.id))
    },
  })

  if (browserLoading || configLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-text-secondary py-8">
        <Loader2 size={16} className="animate-spin" />
        Loading pipelines…
      </div>
    )
  }

  if (repoEmpty) {
    return (
      <EmptyState
        icon={<Workflow size={40} />}
        title="Push code to enable CI/CD"
        description="Pipelines run after you push commits to this repository. Use the Code tab clone instructions to push your first commit."
      />
    )
  }

  if (!hasPipelineConfig) {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-text">Pipelines</h2>
          <p className="text-sm text-text-secondary mt-0.5">
            Add a CI config file to the repository root to get started.
          </p>
        </div>
        <div className="app-panel">
          <EmptyState
            icon={<Workflow size={40} />}
            title="Set up CI/CD"
            description="Commit a .pertisk-ci.yaml file on the default branch. Migrating from GitLab? Use the same job structure with .pertisk-ci.yaml instead of .gitlab-ci.yml."
            action={
              <pre className="text-left text-xs font-mono bg-naturals-n2 border border-naturals-n4 rounded-md p-4 max-w-lg mx-auto overflow-x-auto text-text-secondary">
{`# .pertisk-ci.yaml
jobs:
  build:
    runs_on: self-hosted
    steps:
      - name: test
        run: echo "hello"`}
              </pre>
            }
          />
        </div>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-text-secondary py-8">
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
          <h2 className="text-base font-semibold text-text">Pipelines</h2>
          <p className="text-sm text-text-secondary mt-0.5">
            CI from <code className="text-xs font-mono">.pertisk-ci.yaml</code>
            {runs.length > 0 && (
              <span className="text-muted"> · {runs.length} run{runs.length === 1 ? '' : 's'}</span>
            )}
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

      {rerunMutation.isError && (
        <div className="p-3 rounded-lg border border-red-r1/30 bg-dashboard-danger-bg text-dashboard-danger text-sm">
          {(rerunMutation.error as Error).message}
        </div>
      )}

      <PipelineConfigGraph
        token={token}
        orgSlug={orgSlug}
        repoSlug={repoSlug}
        defaultBranch={defaultBranch}
      />

      <PipelineRunsTable
        runs={runs}
        orgSlug={orgSlug}
        repoSlug={repoSlug}
        onOpenRun={(runId) => navigate(pipelineUrl(orgSlug, repoSlug, runId))}
        onRerun={(runId, scope) => rerunMutation.mutate({ runId, scope })}
        rerunningRunId={rerunningRunId}
      />
    </div>
  )
}

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
  const [selectedJobName, setSelectedJobName] = useState<string | null>(null)

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['pipeline-config-preview', orgSlug, repoSlug, defaultBranch],
    queryFn: () => api.getPipelineConfig(token, orgSlug, repoSlug, defaultBranch),
    enabled: Boolean(token && orgSlug && repoSlug && defaultBranch),
    retry: false,
    staleTime: 5 * 60_000,
  })

  const jobs: PipelineGraphJob[] =
    data?.jobs.map((job) => ({
      name: job.name,
      runs_on: job.runs_on,
      needs: job.needs,
      step_count: job.step_count,
    })) ?? []

  const selectedJob = data?.jobs.find((job) => job.name === selectedJobName) ?? null

  if (isError) {
    return (
      <div className="rounded-lg border border-red-r1/30 bg-dashboard-danger-bg p-4 text-sm text-dashboard-danger">
        <p className="font-medium">Could not load pipeline config</p>
        <p className="mt-1 text-dashboard-danger/90">
          {(error as Error).message.replace(/^validation error:\s*/i, '')}
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-naturals-n4 overflow-hidden">
      <div className="px-3 py-2 border-b border-naturals-n4 bg-naturals-n3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-text font-mono">pipeline graph</h3>
          {data && (
            <p className="text-xs text-text-secondary font-mono mt-0.5">
              {data.config_path} @ {shortSha(data.commit_sha)} ({refLabel(data.ref)})
            </p>
          )}
        </div>
      </div>
      <PipelineGraph
        jobs={jobs}
        loading={isLoading}
        emptyMessage="No jobs in pipeline config"
        selectedJob={selectedJobName}
        onJobSelect={setSelectedJobName}
      />
      {selectedJob && (
        <div className="pipeline-step-preview border-t border-naturals-n4">
          <div className="px-3 py-2 bg-naturals-n3 border-b border-naturals-n4">
            <p className="text-xs font-mono text-text-secondary">
              steps in <strong className="text-text">{selectedJob.name}</strong>
            </p>
          </div>
          <div className="divide-y divide-naturals-n4">
            {selectedJob.steps.map((step) => (
              <div key={step.name} className="pipeline-step-preview-row">
                <span className="pipeline-step-preview-name">{step.name}</span>
                <code className="pipeline-step-preview-run">{step.run}</code>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
