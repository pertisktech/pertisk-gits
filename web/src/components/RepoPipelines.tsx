import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, Loader2, Play, Workflow } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import type { CiConvertResult } from '../api/types'
import type { PipelineGraphJob } from '../lib/pipelineGraphLayout'
import { pipelineRefName, isManualPlayJob, type CiEnvironment } from '../lib/pipelineSummary'
import {
  isRunInProgress,
  pipelineUrl,
  refLabel,
  shortSha,
  type RerunScope,
} from '../lib/pipelineStatus'
import { RepoDetailTabs } from './RepoDetailTabs'
import { PipelineGraph } from './PipelineGraph'
import {
  filterPipelineRuns,
  PipelineRunsTable,
  type PipelineListFilter,
} from './PipelineRunsTable'
import { PipelineSummary } from './PipelineSummary'
import { RunPipelineDialog, type RunPipelineParams } from './RunPipelineDialog'
import { EmptyState, PrimaryButton, SecondaryButton } from './ui'

function PipelineMigratePanel({
  suggestions,
}: {
  suggestions: CiConvertResult[]
}) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [copied, setCopied] = useState(false)

  const active = suggestions[Math.min(selectedIndex, suggestions.length - 1)]

  const copyYaml = async () => {
    if (!active) return
    try {
      await navigator.clipboard.writeText(active.converted_yaml)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // clipboard may be unavailable
    }
  }

  if (!active) return null

  const sourceLabel =
    active.source_kind === 'gitlab' ? 'GitLab CI' : 'GitHub Actions'

  return (
    <div className="app-panel space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-text">Migrate CI config</h3>
        <p className="text-sm text-text-secondary mt-1">
          Found {sourceLabel} at <code className="text-xs">{active.source_path}</code>.
          Copy the suggested <code className="text-xs">.pertisk-ci.yaml</code>, commit it on the default branch, then review runner labels.
        </p>
      </div>

      {suggestions.length > 1 ? (
        <div className="flex flex-wrap gap-2">
          {suggestions.map((item, index) => (
            <button
              key={item.source_path}
              type="button"
              className={`px-3 py-1.5 rounded-md text-xs border transition-colors ${
                index === selectedIndex
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-naturals-n4 text-text-secondary hover:text-text hover:bg-hover'
              }`}
              onClick={() => setSelectedIndex(index)}
            >
              {item.source_path}
            </button>
          ))}
        </div>
      ) : null}

      {active.warnings.length > 0 ? (
        <ul className="text-xs text-yellow-y1 space-y-1 list-disc pl-4">
          {active.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}

      <div className="relative">
        <pre className="text-left text-xs font-mono bg-naturals-n2 border border-naturals-n4 rounded-md p-4 overflow-x-auto text-text-secondary max-h-96">
          {active.converted_yaml}
        </pre>
        <div className="absolute top-2 right-2">
          <SecondaryButton type="button" onClick={copyYaml}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? 'Copied' : 'Copy YAML'}
          </SecondaryButton>
        </div>
      </div>
    </div>
  )
}

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
  const [listFilter, setListFilter] = useState<PipelineListFilter>('all')
  const [listTab, setListTab] = useState<'runs' | 'editor'>('runs')
  const [runDialogOpen, setRunDialogOpen] = useState(false)
  const [runDialogPreset, setRunDialogPreset] = useState<{
    environment?: CiEnvironment
    refKind?: 'branch' | 'tag'
    refName?: string
  }>({})

  const { data: browserData, isLoading: browserLoading } = useQuery({
    queryKey: ['repo-browser', orgSlug, repoSlug],
    queryFn: () => api.getRepoBrowser(orgSlug, repoSlug, token),
    enabled: Boolean(orgSlug && repoSlug),
  })

  const browser = browserData?.browser
  const configRef = browser?.default_ref ?? defaultBranch
  const branches = browser?.branches ?? []
  const tags = browser?.tags ?? []
  const repoEmpty = browserData?.browser.empty ?? false
  const configRefExists = branches.includes(configRef)

  const { data: hasPipelineConfig = false, isLoading: configLoading } = useQuery({
    queryKey: ['pipeline-config', orgSlug, repoSlug, configRef],
    queryFn: async () => {
      const tree = await api.getRepoTree(
        orgSlug,
        repoSlug,
        { ref: configRef, ref_kind: 'branch' },
        token,
      )
      return tree.entries.some(
        (entry) => PIPELINE_CONFIG_FILES.has(entry.name) && entry.kind === 'blob',
      )
    },
    enabled: Boolean(
      token && orgSlug && repoSlug && configRef && browserData && !repoEmpty && configRefExists,
    ),
  })

  const { data: migrateData, isLoading: migrateLoading } = useQuery({
    queryKey: ['pipeline-migrate', orgSlug, repoSlug, configRef],
    queryFn: () => api.getPipelineMigrate(token, orgSlug, repoSlug, configRef),
    enabled: Boolean(
      token &&
        orgSlug &&
        repoSlug &&
        configRef &&
        browserData &&
        !repoEmpty &&
        configRefExists &&
        !hasPipelineConfig,
    ),
    retry: false,
  })

  const migrationSuggestions = useMemo(
    () => migrateData?.suggestions ?? [],
    [migrateData?.suggestions],
  )

  const { data: runs = [], isLoading, error } = useQuery({
    queryKey: ['pipeline-runs', orgSlug, repoSlug],
    queryFn: () => api.listPipelineRuns(token, orgSlug, repoSlug),
    enabled: Boolean(orgSlug && repoSlug && token),
    refetchInterval: (query) => {
      const items = query.state.data ?? []
      return items.some((r) => isRunInProgress(r)) ? 5000 : false
    },
  })

  const runningRuns = useMemo(() => runs.filter((run) => isRunInProgress(run)), [runs])
  const filteredRuns = useMemo(
    () => filterPipelineRuns(runs, listFilter),
    [runs, listFilter],
  )

  const triggerPipelineRun = async ({ refKind, refName, environment }: RunPipelineParams) => {
    const commits = await api.getRepoCommits(
      orgSlug,
      repoSlug,
      { ref: refName, limit: 1, ref_kind: refKind },
      token,
    )
    const head = commits.commits[0]
    if (!head) {
      throw new Error(
        refKind === 'tag'
          ? `No commits for tag ${refName}`
          : `No commits on branch ${refName}`,
      )
    }
    return api.triggerPipeline(token, orgSlug, repoSlug, {
      commit_sha: head.sha,
      ref_name: pipelineRefName(refKind, refName),
      event_type: 'manual',
      ...(environment ? { environment } : {}),
    })
  }

  const triggerMutation = useMutation({
    mutationFn: triggerPipelineRun,
    onSuccess: (newRun) => {
      setRunDialogOpen(false)
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

  function openRunDialog(preset: typeof runDialogPreset = {}) {
    setRunDialogPreset(preset)
    setRunDialogOpen(true)
  }

  const toolbarDisabled = browserLoading
  const contentLoading =
    browserLoading || configLoading || (migrateLoading && !hasPipelineConfig) || isLoading

  let body: ReactNode

  if (repoEmpty) {
    body = (
      <div className="app-panel-body">
        <EmptyState
          icon={<Workflow size={40} />}
          title="Push code to enable CI/CD"
          description="Pipelines run after you push commits to this repository. Use the Code tab clone instructions to push your first commit."
        />
      </div>
    )
  } else if (contentLoading) {
    body = (
      <div className="flex items-center gap-2 text-sm text-text-secondary py-8 px-4">
        <Loader2 size={16} className="animate-spin" />
        Loading pipelines…
      </div>
    )
  } else if (!hasPipelineConfig) {
    body = (
      <div className="p-4">
        <p className="text-sm text-text-secondary">
          No <code className="text-xs font-mono">.pertisk-ci.yaml</code> on{' '}
          <span className="font-mono">{refLabel(pipelineRefName('branch', configRef))}</span>.
          Add a CI config file to the repository root to get started.
        </p>
        {migrationSuggestions.length > 0 ? (
          <PipelineMigratePanel suggestions={migrationSuggestions} />
        ) : (
          <div className="app-panel">
            <EmptyState
              icon={<Workflow size={40} />}
              title="Set up CI/CD"
              description="Commit a .pertisk-ci.yaml file on this branch. Migrating from GitLab or GitHub Actions? Pertisk can suggest a converted config when .gitlab-ci.yml or .github/workflows/* is present."
              action={
                <pre className="text-left text-xs font-mono bg-naturals-n2 border border-naturals-n4 rounded-md p-4 max-w-lg mx-auto overflow-x-auto text-text-secondary">
{`# .pertisk-ci.yaml
on: push
jobs:
  build:
    runs-on: docker
    steps:
      - name: test
        run: echo "hello"`}
                </pre>
              }
            />
          </div>
        )}
      </div>
    )
  } else if (error) {
    body = (
      <div className="p-4">
        <div className="p-3 rounded-lg border border-red-r1/30 bg-dashboard-danger-bg text-dashboard-danger text-sm">
          {(error as Error).message}
        </div>
      </div>
    )
  } else {
    body = (
      <div className="space-y-0">
        {triggerMutation.isError && (
          <div className="m-4 p-3 rounded-lg border border-red-r1/30 bg-dashboard-danger-bg text-dashboard-danger text-sm">
            {(triggerMutation.error as Error).message}
          </div>
        )}

        {rerunMutation.isError && (
          <div className="m-4 p-3 rounded-lg border border-red-r1/30 bg-dashboard-danger-bg text-dashboard-danger text-sm">
            {(rerunMutation.error as Error).message}
          </div>
        )}

        <RepoDetailTabs
          tabs={[
            { id: 'runs', label: `Runs (${runs.length})` },
            { id: 'editor', label: 'Editor' },
          ]}
          active={listTab}
          onChange={(id) => setListTab(id as 'runs' | 'editor')}
        />

        {listTab === 'runs' ? (
          <div className="p-4">
            <div className="repo-list-header mb-4">
              <div className="repo-list-header-segment">
                {(['all', 'running'] as const).map((filter) => (
                  <button
                    key={filter}
                    type="button"
                    className={`repo-list-tab ${listFilter === filter ? 'active' : ''}`}
                    onClick={() => setListFilter(filter)}
                  >
                    {filter === 'all'
                      ? `All (${runs.length})`
                      : `Running (${runningRuns.length})`}
                  </button>
                ))}
              </div>
            </div>

            <PipelineRunsTable
              runs={filteredRuns}
              orgSlug={orgSlug}
              repoSlug={repoSlug}
              onOpenRun={(runId) => navigate(pipelineUrl(orgSlug, repoSlug, runId))}
              onRerun={(runId, scope) => rerunMutation.mutate({ runId, scope })}
              rerunningRunId={rerunningRunId}
              emptyMessage={
                listFilter === 'running'
                  ? 'No pipelines are running right now.'
                  : undefined
              }
            />
          </div>
        ) : (
          <div className="p-4">
            <PipelineConfigGraph
              token={token}
              orgSlug={orgSlug}
              repoSlug={repoSlug}
              configRef={configRef}
              onDeploy={(environment) =>
                openRunDialog({ environment: environment as CiEnvironment })
              }
            />
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4 min-w-0">
      <div className="app-panel">
        {!contentLoading && hasPipelineConfig && (
          <div className="repo-list-header">
            <div className="repo-list-header-segment">
              <span className="repo-list-tab active cursor-default">Pipelines</span>
            </div>
            <div className="repo-list-header-actions">
              <PrimaryButton
                type="button"
                disabled={toolbarDisabled || triggerMutation.isPending}
                onClick={() => openRunDialog()}
              >
                {triggerMutation.isPending ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Play size={14} />
                )}
                Run pipeline
              </PrimaryButton>
            </div>
          </div>
        )}

        <div className="app-panel-body flush space-y-0">
          {body}
        </div>
      </div>

      <RunPipelineDialog
        open={runDialogOpen}
        branches={branches}
        tags={tags}
        defaultBranch={configRef}
        pending={triggerMutation.isPending}
        initialEnvironment={runDialogPreset.environment}
        initialRefKind={runDialogPreset.refKind ?? 'branch'}
        initialRefName={runDialogPreset.refName}
        lockEnvironment={runDialogPreset.environment != null}
        onClose={() => {
          if (!triggerMutation.isPending) setRunDialogOpen(false)
        }}
        onRun={(params) => triggerMutation.mutate(params)}
      />
    </div>
  )
}

function PipelineConfigGraph({
  token,
  orgSlug,
  repoSlug,
  configRef,
  onDeploy,
}: {
  token: string
  orgSlug: string
  repoSlug: string
  configRef: string
  onDeploy?: (environment: string) => void
}) {
  const [selectedJobName, setSelectedJobName] = useState<string | null>(null)

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['pipeline-config-preview', orgSlug, repoSlug, 'branch', configRef],
    queryFn: () => api.getPipelineConfig(token, orgSlug, repoSlug, configRef, 'branch'),
    enabled: Boolean(token && orgSlug && repoSlug && configRef),
    retry: false,
    staleTime: 5 * 60_000,
  })

  const jobs: PipelineGraphJob[] = useMemo(
    () =>
      (data?.jobs ?? []).map((job) => ({
        name: job.name,
        runs_on: job.runs_on,
        needs: job.needs,
        step_count: job.step_count,
        manual_play: isManualPlayJob(job),
      })),
    [data?.jobs],
  )

  const selectedJob = data?.jobs.find((job) => job.name === selectedJobName) ?? null

  useEffect(() => {
    setSelectedJobName(null)
  }, [configRef])

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
      {data && <PipelineSummary config={data} onDeploy={onDeploy} />}
      <div className="px-3 py-2 border-b border-naturals-n4 bg-naturals-n3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-text">Workflow graph</h3>
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
