import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, Loader2, Play, Workflow } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import type { CiConvertResult } from '../api/types'
import type { PipelineGraphJob } from '../lib/pipelineGraphLayout'
import {
  filterJobsForViewRef,
  pipelineRefName,
  previewEventForRef,
  refTriggersOnPush,
  viewRefFromKind,
  type SummaryViewRef,
} from '../lib/pipelineSummary'
import {
  isRunInProgress,
  pipelineUrl,
  refLabel,
  shortSha,
  type RerunScope,
} from '../lib/pipelineStatus'
import { PipelineGraph } from './PipelineGraph'
import { PipelineRunsTable } from './PipelineRunsTable'
import { PipelineSummary } from './PipelineSummary'
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

function PipelineRefToolbar({
  viewRefKind,
  activeRefName,
  refList,
  branchCount,
  tagCount,
  disabled,
  showRunWorkflow,
  runWorkflowPending,
  onRefKindChange,
  onRefChange,
  onRunWorkflow,
}: {
  viewRefKind: 'branch' | 'tag'
  activeRefName: string
  refList: string[]
  branchCount: number
  tagCount: number
  disabled?: boolean
  showRunWorkflow?: boolean
  runWorkflowPending?: boolean
  onRefKindChange: (kind: 'branch' | 'tag') => void
  onRefChange: (name: string) => void
  onRunWorkflow?: () => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 shrink-0">
      <select
        id="pipeline-ref-kind"
        value={viewRefKind}
        onChange={(event) => onRefKindChange(event.target.value as 'branch' | 'tag')}
        className="app-branch-select"
        aria-label="Reference type"
        disabled={disabled}
      >
        <option value="branch">Branch</option>
        <option value="tag">Tag</option>
      </select>
      <select
        id="pipeline-view-ref"
        value={activeRefName}
        onChange={(event) => onRefChange(event.target.value)}
        className="app-branch-select min-w-[8rem]"
        disabled={disabled || refList.length === 0}
        aria-label={viewRefKind === 'tag' ? 'Tag' : 'Branch'}
      >
        {refList.length === 0 ? (
          <option value={activeRefName}>
            {viewRefKind === 'tag' ? 'No tags' : activeRefName}
          </option>
        ) : (
          refList.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))
        )}
      </select>
      <span className="text-sm text-text-secondary whitespace-nowrap hidden sm:inline">
        {branchCount} Branch.{`  ${tagCount} Tags`}
      </span>
      {showRunWorkflow && onRunWorkflow && (
        <PrimaryButton
          type="button"
          disabled={disabled || runWorkflowPending || refList.length === 0}
          onClick={onRunWorkflow}
        >
          {runWorkflowPending ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Play size={14} />
          )}
          Run workflow
        </PrimaryButton>
      )}
    </div>
  )
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
  const [viewRefKind, setViewRefKind] = useState<'branch' | 'tag'>('branch')
  const [viewRefOverride, setViewRefOverride] = useState<string | null>(null)
  const [showAllPaths, setShowAllPaths] = useState(false)

  const { data: browserData, isLoading: browserLoading } = useQuery({
    queryKey: ['repo-browser', orgSlug, repoSlug],
    queryFn: () => api.getRepoBrowser(orgSlug, repoSlug, token),
    enabled: Boolean(orgSlug && repoSlug),
  })

  const browser = browserData?.browser
  const refList = useMemo(
    () =>
      viewRefKind === 'tag'
        ? browser?.tags ?? []
        : browser?.branches?.length
          ? browser.branches
          : [defaultBranch],
    [viewRefKind, browser?.tags, browser?.branches, defaultBranch],
  )
  const activeRefName = useMemo(() => {
    if (viewRefOverride && refList.includes(viewRefOverride)) return viewRefOverride
    const preferred = viewRefKind === 'branch' ? (browser?.default_ref ?? defaultBranch) : refList[0]
    if (preferred && refList.includes(preferred)) return preferred
    return refList[0] ?? defaultBranch
  }, [viewRefOverride, refList, viewRefKind, browser?.default_ref, defaultBranch])

  const viewRef = useMemo(
    () => viewRefFromKind(viewRefKind, activeRefName),
    [viewRefKind, activeRefName],
  )

  const repoEmpty = browserData?.browser.empty ?? false

  const branchCount = browser?.branches?.length ?? 0
  const tagCount = browser?.tags?.length ?? 0

  const { data: hasPipelineConfig = false, isLoading: configLoading } = useQuery({
    queryKey: ['pipeline-config', orgSlug, repoSlug, viewRefKind, activeRefName],
    queryFn: async () => {
      const tree = await api.getRepoTree(
        orgSlug,
        repoSlug,
        { ref: activeRefName, ref_kind: viewRefKind },
        token,
      )
      return tree.entries.some(
        (entry) => PIPELINE_CONFIG_FILES.has(entry.name) && entry.kind === 'blob',
      )
    },
    enabled: Boolean(token && orgSlug && repoSlug && activeRefName && browserData && !repoEmpty),
  })

  const { data: migrateData, isLoading: migrateLoading } = useQuery({
    queryKey: ['pipeline-migrate', orgSlug, repoSlug, viewRefKind, activeRefName],
    queryFn: () => api.getPipelineMigrate(token, orgSlug, repoSlug, activeRefName),
    enabled: Boolean(
      token && orgSlug && repoSlug && activeRefName && browserData && !repoEmpty && !hasPipelineConfig,
    ),
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

  const { data: pipelineConfig } = useQuery({
    queryKey: ['pipeline-config-preview', orgSlug, repoSlug, viewRefKind, activeRefName],
    queryFn: () => api.getPipelineConfig(token, orgSlug, repoSlug, activeRefName, viewRefKind),
    enabled: Boolean(token && orgSlug && repoSlug && activeRefName && hasPipelineConfig),
    retry: false,
    staleTime: 5 * 60_000,
  })

  const autoTriggerRef = useMemo(
    () => refTriggersOnPush(pipelineConfig, viewRef, viewRefKind),
    [pipelineConfig, viewRef, viewRefKind],
  )

  const triggerMutation = useMutation({
    mutationFn: async () => {
      const commits = await api.getRepoCommits(
        orgSlug,
        repoSlug,
        { ref: activeRefName, limit: 1, ref_kind: viewRefKind },
        token,
      )
      const head = commits.commits[0]
      if (!head) {
        throw new Error(
          viewRefKind === 'tag'
            ? `No commits for tag ${activeRefName}`
            : `No commits on branch ${activeRefName}`,
        )
      }
      return api.triggerPipeline(token, orgSlug, repoSlug, {
        commit_sha: head.sha,
        ref_name: pipelineRefName(viewRefKind, activeRefName),
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

  const toolbarDisabled = browserLoading
  const contentLoading =
    browserLoading || configLoading || (migrateLoading && !hasPipelineConfig) || isLoading

  let body: ReactNode

  if (repoEmpty) {
    body = (
      <EmptyState
        icon={<Workflow size={40} />}
        title="Push code to enable CI/CD"
        description="Pipelines run after you push commits to this repository. Use the Code tab clone instructions to push your first commit."
      />
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
      <div className="space-y-4 p-4">
        <p className="text-sm text-text-secondary">
          No <code className="text-xs font-mono">.pertisk-ci.yaml</code> on{' '}
          <span className="font-mono">{refLabel(pipelineRefName(viewRefKind, activeRefName))}</span>.
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
      <div className="space-y-4 p-4">
        {autoTriggerRef && (
          <p className="text-sm text-text-secondary">
            Pushes to this {viewRefKind} start the pipeline automatically.
          </p>
        )}

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
          configRef={activeRefName}
          configRefKind={viewRefKind}
          viewRef={viewRef}
          showAllPaths={showAllPaths}
          onShowAllPathsChange={setShowAllPaths}
        />

        <PipelineRunsTable
          runs={runs}
          orgSlug={orgSlug}
          repoSlug={repoSlug}
          viewRef={viewRef}
          onOpenRun={(runId) => navigate(pipelineUrl(orgSlug, repoSlug, runId))}
          onRerun={(runId, scope) => rerunMutation.mutate({ runId, scope })}
          rerunningRunId={rerunningRunId}
        />
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-naturals-n4 overflow-hidden">
      <div className="app-toolbar flex-wrap justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-text">Workflow runs</h2>
          <p className="text-sm text-text-secondary mt-0.5">
            CI from <code className="text-xs font-mono">.pertisk-ci.yaml</code>
            {!contentLoading && runs.length > 0 && (
              <span className="text-muted"> · {runs.length} run{runs.length === 1 ? '' : 's'}</span>
            )}
          </p>
        </div>
        <PipelineRefToolbar
          viewRefKind={viewRefKind}
          activeRefName={activeRefName}
          refList={refList}
          branchCount={branchCount}
          tagCount={tagCount}
          disabled={toolbarDisabled}
          showRunWorkflow={!contentLoading && hasPipelineConfig && !autoTriggerRef}
          runWorkflowPending={triggerMutation.isPending}
          onRefKindChange={(kind) => {
            setViewRefKind(kind)
            setViewRefOverride(null)
          }}
          onRefChange={setViewRefOverride}
          onRunWorkflow={() => triggerMutation.mutate()}
        />
      </div>
      {body}
    </div>
  )
}

function PipelineConfigGraph({
  token,
  orgSlug,
  repoSlug,
  configRef,
  configRefKind,
  viewRef,
  showAllPaths,
  onShowAllPathsChange,
}: {
  token: string
  orgSlug: string
  repoSlug: string
  configRef: string
  configRefKind: 'branch' | 'tag'
  viewRef: SummaryViewRef
  showAllPaths: boolean
  onShowAllPathsChange: (value: boolean) => void
}) {
  const [selectedJobName, setSelectedJobName] = useState<string | null>(null)

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['pipeline-config-preview', orgSlug, repoSlug, configRefKind, configRef],
    queryFn: () => api.getPipelineConfig(token, orgSlug, repoSlug, configRef, configRefKind),
    enabled: Boolean(token && orgSlug && repoSlug && configRef),
    retry: false,
    staleTime: 5 * 60_000,
  })

  const previewEvent = useMemo(
    () => previewEventForRef(viewRef, configRefKind),
    [viewRef, configRefKind],
  )

  const visibleJobs = useMemo(() => {
    if (!data?.jobs) return []
    if (showAllPaths) return data.jobs
    return filterJobsForViewRef(data.jobs, viewRef, previewEvent)
  }, [data?.jobs, showAllPaths, viewRef, previewEvent])

  const jobs: PipelineGraphJob[] = useMemo(
    () =>
      visibleJobs.map((job) => ({
        name: job.name,
        runs_on: job.runs_on,
        needs: job.needs.filter((dep) => visibleJobs.some((entry) => entry.name === dep)),
        step_count: job.step_count,
      })),
    [visibleJobs],
  )

  const selectedJob = visibleJobs.find((job) => job.name === selectedJobName) ?? null

  useEffect(() => {
    setSelectedJobName(null)
  }, [configRef, configRefKind, showAllPaths])

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
      {data && (
        <PipelineSummary
          config={data}
          viewRef={viewRef}
          showAllPaths={showAllPaths}
          onShowAllPathsChange={onShowAllPathsChange}
        />
      )}
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
