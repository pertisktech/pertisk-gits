import type {
  JobIfCondition,
  JobRun,
  PipelineConfigPreview,
  PipelineJobPreview,
  PipelineRun,
} from '../api/types'
import { isConfigSkippedJob } from './pipelineStatus'

export interface PipelinePathSummary {
  id: string
  title: string
  environment?: string
  triggerLabel: string
  automatic: boolean
  jobs: string[]
  buildJobs: string[]
  deployJobs: string[]
}

export const CI_ENVIRONMENTS = ['dev', 'qa', 'uat', 'prd'] as const
export type CiEnvironment = (typeof CI_ENVIRONMENTS)[number]

export interface SummaryViewRef {
  branch?: string
  tag?: string
}

export interface PipelineSummaryOptions {
  viewRef?: SummaryViewRef
  showAllPaths?: boolean
}

/** Full git ref for pipeline triggers (refs/heads/* or refs/tags/*). */
export function pipelineRefName(kind: 'branch' | 'tag', name: string): string {
  return kind === 'tag' ? `refs/tags/${name}` : `refs/heads/${name}`
}

export function viewRefFromKind(kind: 'branch' | 'tag', name: string): SummaryViewRef {
  return kind === 'tag' ? { tag: name } : { branch: name }
}

export function parseViewRef(ref: string): SummaryViewRef {
  if (ref.startsWith('refs/tags/')) {
    return { tag: ref.slice('refs/tags/'.length) }
  }
  if (ref.startsWith('refs/heads/')) {
    return { branch: ref.slice('refs/heads/'.length) }
  }
  return { branch: ref }
}

/** ref_kind for pipeline config API from a full git ref. */
export function refKindFromRefName(refName: string): 'branch' | 'tag' {
  return refName.startsWith('refs/tags/') ? 'tag' : 'branch'
}

/** Branch or tag name for pipeline config API (?ref=). */
export function refForConfigQuery(refName: string): string {
  if (refName.startsWith('refs/tags/')) {
    return refName.slice('refs/tags/'.length)
  }
  if (refName.startsWith('refs/heads/')) {
    return refName.slice('refs/heads/'.length)
  }
  return refName
}

export function viewRefLabel(viewRef?: SummaryViewRef): string | null {
  if (!viewRef) return null
  if (viewRef.tag) return `tag ${viewRef.tag}`
  if (viewRef.branch) return `branch ${viewRef.branch}`
  return null
}

function pathMatchesView(
  def: (typeof PATH_DEFS)[number],
  viewRef: SummaryViewRef,
): boolean {
  if (viewRef.tag) {
    if (!def.tag) return false
    return matchesPatterns(['release/*'], viewRef.tag)
  }
  if (viewRef.branch) {
    if (def.tag) return false
    return def.branch === viewRef.branch
  }
  return true
}

const PATH_DEFS: Array<{
  id: string
  title: string
  environment: string
  branch?: string
  tag?: string
  automatic: boolean
  triggerLabel: string
}> = [
  {
    id: 'main',
    title: 'main → dev',
    environment: 'dev',
    branch: 'main',
    automatic: true,
    triggerLabel: 'Automatic on push to main — build + deploy dev',
  },
  {
    id: 'qa',
    title: 'manual → qa',
    environment: 'qa',
    automatic: false,
    triggerLabel: 'Manual — pick branch or tag, Deploy qa',
  },
  {
    id: 'uat',
    title: 'manual → uat',
    environment: 'uat',
    automatic: false,
    triggerLabel: 'Manual — pick branch or tag, Deploy uat',
  },
]

export function globMatch(pattern: string, value: string): boolean {
  if (pattern === '*') return true
  if (pattern.startsWith('*')) return value.endsWith(pattern.slice(1))
  if (pattern.endsWith('*')) return value.startsWith(pattern.slice(0, -1))
  return pattern === value
}

function matchesPatterns(patterns: string[] | undefined, value: string): boolean {
  if (!patterns || patterns.length === 0) return true
  return patterns.some((pattern) => globMatch(pattern, value))
}

function listValue(value: string | string[] | undefined): string[] | undefined {
  if (value === undefined) return undefined
  return Array.isArray(value) ? value : [value]
}

/** Match job if: branch/tag scope only (ignore event — for summary display). */
function jobMatchesPathScope(
  condition: JobIfCondition | undefined,
  branch?: string,
  tag?: string,
): boolean {
  if (!condition) return true

  if (condition.branch !== undefined) {
    if (!branch) return false
    const patterns = listValue(condition.branch)
    if (!patterns || !matchesPatterns(patterns, branch)) return false
  }

  if (condition.tag !== undefined) {
    if (!tag) return false
    if (condition.tag === true) return true
    const patterns = listValue(condition.tag as string | string[] | undefined)
    if (!patterns || !matchesPatterns(patterns, tag)) return false
  }

  return true
}

function topoSortAll(jobs: PipelineJobPreview[]): string[] {
  const byName = new Map(jobs.map((job) => [job.name, job]))
  const indegree = new Map<string, number>()

  for (const job of jobs) {
    indegree.set(
      job.name,
      job.needs.filter((dep) => byName.has(dep)).length,
    )
  }

  const queue = [...indegree.entries()]
    .filter(([, degree]) => degree === 0)
    .map(([name]) => name)
    .sort()

  const ordered: string[] = []
  while (queue.length > 0) {
    const name = queue.shift()!
    ordered.push(name)

    for (const job of jobs) {
      if (!job.needs.includes(name)) continue
      const next = (indegree.get(job.name) ?? 0) - 1
      indegree.set(job.name, next)
      if (next === 0) {
        queue.push(job.name)
        queue.sort()
      }
    }
  }

  return ordered
}

/** Shared build jobs — no if: condition (unit-test, build-docker, …). */
export function sharedBuildJobs(jobs: PipelineJobPreview[]): string[] {
  return topoSortAll(jobs).filter((name) => {
    const job = jobs.find((entry) => entry.name === name)
    return job && !job.if
  })
}

/** Jobs shown for a branch/tag path: always build chain + matching env jobs. */
export function jobsForPathScope(
  jobs: PipelineJobPreview[],
  branch?: string,
  tag?: string,
): string[] {
  return topoSortAll(jobs).filter((name) => {
    const job = jobs.find((entry) => entry.name === name)
    if (!job) return false
    if (!job.if) return true
    return jobMatchesPathScope(job.if, branch, tag)
  })
}

function splitBuildDeploy(
  jobs: PipelineJobPreview[],
  pathJobs: string[],
): { buildJobs: string[]; deployJobs: string[] } {
  const buildSet = new Set(sharedBuildJobs(jobs))
  const buildJobs: string[] = []
  const deployJobs: string[] = []
  for (const name of pathJobs) {
    if (buildSet.has(name)) buildJobs.push(name)
    else deployJobs.push(name)
  }
  return { buildJobs, deployJobs }
}

export function inferPipelinePaths(
  config: PipelineConfigPreview,
  options?: PipelineSummaryOptions,
): PipelinePathSummary[] {
  const { jobs, on: triggers } = config
  if (jobs.length === 0) return []

  const showAll = options?.showAllPaths ?? false
  const viewRef = options?.viewRef

  const hasIf = jobs.some((job) => job.if)
  const allPaths = hasIf
    ? inferPipelinePathsWithIf(jobs, triggers)
    : inferPipelinePathsFromSuffixes(config)

  if (showAll || !viewRef || (!viewRef.branch && !viewRef.tag)) {
    return allPaths
  }

  const filtered = allPaths.filter((path) => {
    const def = PATH_DEFS.find((entry) => entry.id === path.id)
    if (!def) return path.id === 'all'
    return pathMatchesView(def, viewRef)
  })

  if (filtered.length > 0) return filtered

  if (viewRef.branch) {
    const buildOnly = sharedBuildJobs(jobs)
    if (buildOnly.length > 0) {
      return [
        {
          id: 'build',
          title: viewRef.branch,
          triggerLabel: 'Push: build chain only (no deploy for this branch)',
          automatic: Boolean(triggers.push?.branches?.length),
          jobs: buildOnly,
          buildJobs: buildOnly,
          deployJobs: [],
        },
      ]
    }
  }

  return filtered
}

export function previewEventForRef(
  _viewRef: SummaryViewRef,
  _refKind: 'branch' | 'tag',
): string {
  return 'push'
}

export function previewContextForRef(viewRef: SummaryViewRef): PathContext {
  return {
    event_type: 'push',
    branch: viewRef.branch,
    tag: viewRef.tag,
    environment: inferEnvironmentFromRef(viewRef),
  }
}

/** Whether push to this ref starts a pipeline automatically (from on.push in config). */
export function refTriggersOnPush(
  config: PipelineConfigPreview | undefined,
  viewRef: SummaryViewRef,
  refKind: 'branch' | 'tag',
): boolean {
  const push = config?.on.push
  if (!push) return false
  if (refKind === 'tag' && viewRef.tag) {
    return push.tags?.some((pattern) => globMatch(pattern, viewRef.tag!)) ?? false
  }
  if (viewRef.branch) {
    return push.branches?.some((pattern) => globMatch(pattern, viewRef.branch!)) ?? false
  }
  return false
}

export function runMatchesViewRef(run: PipelineRun, viewRef: SummaryViewRef): boolean {
  const parsed = parseViewRef(run.ref_name)
  if (viewRef.tag) return parsed.tag === viewRef.tag
  if (viewRef.branch) return parsed.branch === viewRef.branch
  return true
}

export function filterJobsForViewRef(
  jobs: PipelineJobPreview[],
  viewRef?: SummaryViewRef,
  eventType?: string,
): PipelineJobPreview[] {
  if (!viewRef || (!viewRef.branch && !viewRef.tag)) return jobs

  const hasIf = jobs.some((job) => job.if)
  if (hasIf) {
    return jobsForViewScope(jobs, viewRef, eventType ?? 'push')
  }

  return jobs.filter((job) => jobNameMatchesView(job.name, viewRef))
}

export function filterRunJobsForList(run: PipelineRun): JobRun[] {
  return run.jobs.filter((job) => !isConfigSkippedJob(job))
}

/** Jobs visible for a manual Run pipeline with a target environment. */
export function filterRunJobsForManualDeploy(run: PipelineRun): JobRun[] {
  const jobs = filterRunJobsForList(run)
  if (run.event_type !== 'manual' || !run.target_environment) return jobs

  const env = run.target_environment
  return jobs.filter((job) => {
    const jobEnv = jobEnvironmentFromName(job.job_name)
    // Build/test jobs (no env suffix) are part of every manual run.
    if (!jobEnv) return true
    return jobEnv === env
  })
}

function jobEnvironmentFromName(name: string): string | null {
  for (const env of ['dev', 'qa', 'uat', 'prd', 'prod']) {
    if (name.endsWith(`-${env}`)) return env === 'prod' ? 'prd' : env
  }
  return null
}

export function filterRunJobsForViewRef(
  runJobs: JobRun[],
  configJobs: PipelineJobPreview[],
  viewRef?: SummaryViewRef,
  eventType?: string,
): JobRun[] {
  if (!viewRef || (!viewRef.branch && !viewRef.tag)) return runJobs
  const names = new Set(
    jobsForViewScope(configJobs, viewRef, eventType).map((job) => job.name),
  )
  return runJobs.filter((job) => names.has(job.job_name))
}

/** Run detail: show jobs matching this run's ref + event (including skipped in scope). */
export function filterVisibleRunJobs(
  runJobs: JobRun[],
  options: {
    viewRef?: SummaryViewRef
    showAllPaths?: boolean
    configJobs?: PipelineJobPreview[]
    eventType?: string
  },
): JobRun[] {
  const { viewRef, showAllPaths, configJobs, eventType } = options
  if (runJobs.length === 0) return runJobs
  if (showAllPaths) return runJobs
  if (!viewRef?.branch && !viewRef?.tag) return runJobs

  if (configJobs?.length) {
    return filterRunJobsForViewRef(
      runJobs,
      configJobs,
      viewRef,
      eventType ?? 'push',
    )
  }

  return runJobs.filter((job) => jobNameMatchesView(job.job_name, viewRef))
}

function pathTriggersOnPush(
  def: (typeof PATH_DEFS)[number],
  triggers: PipelineConfigPreview['on'],
): boolean {
  if (def.branch) {
    return triggers.push?.branches?.some((branch) => globMatch(branch, def.branch!)) ?? false
  }
  if (def.id === 'release') {
    return triggers.push?.tags?.some((tag) => globMatch(tag, 'release/*')) ?? false
  }
  return false
}

function inferPipelinePathsWithIf(
  jobs: PipelineJobPreview[],
  triggers: PipelineConfigPreview['on'],
): PipelinePathSummary[] {
  const paths: PipelinePathSummary[] = []
  for (const def of PATH_DEFS) {
    const ctx: PathContext = {
      event_type: def.automatic ? 'push' : 'manual',
      branch: def.branch,
      tag: def.tag,
      environment: def.environment,
    }
    const pathJobs = topoSortAll(jobs).filter((name) => {
      const job = jobs.find((entry) => entry.name === name)
      return job && evaluateJobIf(job.if, ctx)
    })
    if (pathJobs.length === 0) continue

    const { buildJobs, deployJobs } = splitBuildDeploy(jobs, pathJobs)
    paths.push({
      id: def.id,
      title: def.title,
      environment: def.environment,
      triggerLabel: def.triggerLabel,
      automatic: def.automatic && pathTriggersOnPush(def, triggers),
      jobs: pathJobs,
      buildJobs,
      deployJobs,
    })
  }

  if (paths.length === 0) {
    const ordered = topoSortAll(jobs)
    const { buildJobs, deployJobs } = splitBuildDeploy(jobs, ordered)
    return [
      {
        id: 'all',
        title: 'workflow',
        triggerLabel: 'All jobs when workflow triggers',
        automatic: Boolean(triggers.push?.branches?.length),
        jobs: ordered,
        buildJobs,
        deployJobs,
      },
    ]
  }

  return paths
}

export function pipelineSummaryNeedsJobFilter(config: PipelineConfigPreview): boolean {
  return !config.jobs.some((job) => job.if)
}

function jobEnvironment(name: string): string | null {
  for (const env of ['dev', 'qa', 'uat', 'prd', 'prod']) {
    if (name.endsWith(`-${env}`)) return env
  }
  return null
}

function deployEnvForViewRef(viewRef?: SummaryViewRef): string | null {
  if (!viewRef) return null
  if (viewRef.tag) {
    return matchesPatterns(['release/*'], viewRef.tag) ? 'prd' : null
  }
  if (viewRef.branch === 'main') return 'dev'
  if (viewRef.branch === 'qa') return 'qa'
  if (viewRef.branch === 'uat') return 'uat'
  return null
}

function jobNameMatchesView(jobName: string, viewRef?: SummaryViewRef): boolean {
  if (!viewRef || (!viewRef.branch && !viewRef.tag)) return true
  const env = jobEnvironment(jobName)
  if (env === null) return true
  const targetEnv = deployEnvForViewRef(viewRef)
  if (!targetEnv) return false
  return env === targetEnv || (targetEnv === 'prd' && env === 'prod')
}

/** Config jobs visible for a branch/tag; uses event when evaluating if:. */
export function jobsForViewScope(
  jobs: PipelineJobPreview[],
  viewRef: SummaryViewRef,
  eventType?: string,
): PipelineJobPreview[] {
  if (!viewRef.branch && !viewRef.tag) return jobs

  const hasIf = jobs.some((job) => job.if)
  if (hasIf) {
    const ctx: PathContext = {
      branch: viewRef.branch,
      tag: viewRef.tag,
      event_type: eventType ?? 'push',
      environment: inferEnvironmentFromRef(viewRef),
    }
    const names = new Set(
      topoSortAll(jobs).filter((name) => {
        const job = jobs.find((entry) => entry.name === name)
        return job && evaluateJobIf(job.if, ctx)
      }),
    )
    return jobs.filter((job) => names.has(job.name))
  }

  return jobs.filter((job) => jobNameMatchesView(job.name, viewRef))
}

function inferPipelinePathsFromSuffixes(config: PipelineConfigPreview): PipelinePathSummary[] {
  const { jobs, on: triggers } = config
  const ordered = topoSortAll(jobs)

  const paths: PipelinePathSummary[] = []
  const envs = [
    { id: 'main', env: 'dev', title: 'main', branch: 'main', automatic: true },
    { id: 'qa', env: 'qa', title: 'qa', branch: 'qa', automatic: false },
    { id: 'uat', env: 'uat', title: 'uat', branch: 'uat', automatic: false },
    { id: 'release', env: 'prd', title: 'release tag', branch: 'release/*', automatic: false },
  ]

  for (const def of envs) {
    const pathJobs = ordered.filter((name) => {
      const env = jobEnvironment(name)
      return env === null || env === def.env
    })
    if (pathJobs.length === 0 || !pathJobs.some((name) => jobEnvironment(name) === def.env)) {
      if (def.env !== 'dev') continue
    }

    const { buildJobs, deployJobs } = splitBuildDeploy(jobs, pathJobs)
    paths.push({
      id: def.id,
      title: def.title,
      environment: def.env,
      triggerLabel: def.automatic
        ? `Automatic on push to ${def.branch}`
        : `Manual deploy (${def.env})`,
      automatic:
        def.automatic &&
        Boolean(triggers.push?.branches?.some((branch) => globMatch(branch, def.branch))),
      jobs: pathJobs,
      buildJobs,
      deployJobs,
    })
  }

  return paths
}

// Runtime evaluation (unchanged) for tests / future use
export interface PathContext {
  event_type: string
  branch?: string
  tag?: string
  environment?: string
}

export function evaluateJobIf(condition: JobIfCondition | undefined, ctx: PathContext): boolean {
  if (!condition) return true

  if (condition.branch !== undefined) {
    if (ctx.tag) return false
    if (!ctx.branch) return false
    const patterns = listValue(condition.branch)
    if (!patterns || !matchesPatterns(patterns, ctx.branch)) return false
  }

  if (condition.tag !== undefined) {
    if (!ctx.tag) return false
    if (condition.tag === true) return true
    const patterns = listValue(condition.tag as string | string[] | undefined)
    if (!patterns || !matchesPatterns(patterns, ctx.tag)) return false
  }

  if (condition.event !== undefined) {
    const patterns = listValue(condition.event)
    if (!patterns || !matchesPatterns(patterns, ctx.event_type)) return false
  }

  if (condition.environment !== undefined) {
    if (!ctx.environment) return false
    const patterns = listValue(condition.environment)
    if (!patterns || !matchesPatterns(patterns, ctx.environment)) return false
  }

  return true
}

/** Infer deploy environment from branch/tag (matches backend). */
export function inferEnvironmentFromRef(viewRef: SummaryViewRef): string | undefined {
  if (viewRef.tag) {
    return matchesPatterns(['release/*'], viewRef.tag) ? 'prd' : undefined
  }
  if (viewRef.branch === 'main') return 'dev'
  if (viewRef.branch === 'qa') return 'qa'
  if (viewRef.branch === 'uat') return 'uat'
  return undefined
}
