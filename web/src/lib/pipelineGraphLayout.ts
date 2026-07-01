import type { Edge, Node } from '@xyflow/react'
import type { JobRun, PipelineJobPreview, PipelineRun } from '../api/types'
import { filterJobsForViewRef, type SummaryViewRef } from './pipelineSummary'

export interface PipelineGraphJob {
  name: string
  runs_on: string
  needs: string[]
  status?: JobRun['status']
  step_count?: number
  job_id?: string
}

export interface PipelineGraphNodeData extends Record<string, unknown> {
  job: PipelineGraphJob
  selected: boolean
  onSelect?: (name: string) => void
  onPlay?: (name: string) => void
  canPlay?: boolean
  onRerun?: (name: string) => void
  canRerun?: boolean
  rerunPending?: boolean
}

const NODE_WIDTH = 176
const COL_GAP = 248
const ROW_GAP = 88

function jobDepths(jobs: PipelineGraphJob[]): Map<string, number> {
  const byName = new Map(jobs.map((job) => [job.name, job]))
  const depths = new Map<string, number>()

  const depth = (name: string, visiting: Set<string>): number => {
    const cached = depths.get(name)
    if (cached !== undefined) return cached
    if (visiting.has(name)) return 0
    visiting.add(name)

    const job = byName.get(name)
    if (!job || job.needs.length === 0) {
      depths.set(name, 0)
      return 0
    }

    const value = 1 + Math.max(...job.needs.map((dep) => depth(dep, visiting)))
    depths.set(name, value)
    return value
  }

  jobs.forEach((job) => {
    depth(job.name, new Set())
  })

  return depths
}

export function layoutPipelineGraph(
  jobs: PipelineGraphJob[],
  options?: { selectedJob?: string | null },
): { nodes: Node<PipelineGraphNodeData>[]; edges: Edge[] } {
  if (jobs.length === 0) {
    return { nodes: [], edges: [] }
  }

  const depths = jobDepths(jobs)
  const colNodes = new Map<number, PipelineGraphJob[]>()

  for (const job of jobs) {
    const col = depths.get(job.name) ?? 0
    const bucket = colNodes.get(col) ?? []
    bucket.push(job)
    colNodes.set(col, bucket)
  }

  const sortedCols = [...colNodes.keys()].sort((a, b) => a - b)
  sortedCols.forEach((col) => {
    colNodes.get(col)?.sort((a, b) => a.name.localeCompare(b.name))
  })

  const incoming = new Map<string, string[]>()
  const outgoing = new Map<string, string[]>()
  jobs.forEach((job) => {
    incoming.set(job.name, [])
    outgoing.set(job.name, [])
  })
  jobs.forEach((job) => {
    job.needs.forEach((dep) => {
      if (!incoming.has(job.name) || !outgoing.has(dep)) return
      incoming.get(job.name)?.push(dep)
      outgoing.get(dep)?.push(job.name)
    })
  })

  const orderIndex = new Map<string, number>()
  const refreshOrderIndex = () => {
    sortedCols.forEach((col) => {
      colNodes.get(col)?.forEach((job, index) => {
        orderIndex.set(job.name, index)
      })
    })
  }

  const barycenter = (neighborIds: string[]) => {
    const positions = neighborIds
      .map((id) => orderIndex.get(id))
      .filter((value): value is number => value !== undefined)
    if (positions.length === 0) return Number.POSITIVE_INFINITY
    return positions.reduce((sum, value) => sum + value, 0) / positions.length
  }

  refreshOrderIndex()

  for (let pass = 0; pass < 4; pass += 1) {
    for (let i = 1; i < sortedCols.length; i += 1) {
      const col = sortedCols[i]
      colNodes.get(col)?.sort((a, b) => {
        const baryA = barycenter(incoming.get(a.name) ?? [])
        const baryB = barycenter(incoming.get(b.name) ?? [])
        if (baryA === baryB) return a.name.localeCompare(b.name)
        return baryA - baryB
      })
      refreshOrderIndex()
    }

    for (let i = sortedCols.length - 2; i >= 0; i -= 1) {
      const col = sortedCols[i]
      colNodes.get(col)?.sort((a, b) => {
        const baryA = barycenter(outgoing.get(a.name) ?? [])
        const baryB = barycenter(outgoing.get(b.name) ?? [])
        if (baryA === baryB) return a.name.localeCompare(b.name)
        return baryA - baryB
      })
      refreshOrderIndex()
    }
  }

  const positions = new Map<string, { x: number; y: number }>()
  sortedCols.forEach((col) => {
    colNodes.get(col)?.forEach((job, index) => {
      positions.set(job.name, { x: col * COL_GAP, y: index * ROW_GAP })
    })
  })

  const selectedJob = options?.selectedJob ?? null
  const nodes: Node<PipelineGraphNodeData>[] = jobs.map((job) => ({
    id: job.name,
    type: 'pipelineJob',
    position: positions.get(job.name) ?? { x: 0, y: 0 },
    data: {
      job,
      selected: selectedJob === job.name || selectedJob === job.job_id,
    },
    width: NODE_WIDTH,
  }))

  const statusByName = new Map(jobs.map((job) => [job.name, job.status]))
  const edges: Edge[] = jobs.flatMap((job) =>
    job.needs
      .filter((dep) => positions.has(dep))
      .map((dep) => {
        const depStatus = statusByName.get(dep)
        const stroke =
          depStatus === 'success'
            ? '#3fb950'
            : depStatus === 'failure'
              ? '#f85149'
              : depStatus === 'running'
                ? '#d29922'
                : depStatus === 'skipped'
                  ? 'var(--color-naturals-n7)'
                  : 'var(--color-border)'

        return {
          id: `${dep}->${job.name}`,
          source: dep,
          target: job.name,
          type: 'smoothstep',
          animated: depStatus === 'running',
          style: { stroke, strokeWidth: 1.5 },
          markerEnd: {
            type: 'arrowclosed' as const,
            color: stroke,
            width: 16,
            height: 16,
          },
        }
      }),
  )

  return { nodes, edges }
}

export function graphHeight(jobs: PipelineGraphJob[]): number {
  if (jobs.length === 0) return 160
  const depths = jobDepths(jobs)
  const colSizes = new Map<number, number>()
  jobs.forEach((job) => {
    const col = depths.get(job.name) ?? 0
    colSizes.set(col, (colSizes.get(col) ?? 0) + 1)
  })
  const maxColSize = Math.max(...colSizes.values(), 1)
  return Math.min(420, Math.max(200, maxColSize * ROW_GAP + 72))
}

/** Detail page graph: full config topology with run status merged where jobs executed. */
export function buildDetailGraphJobs(
  configJobs: PipelineJobPreview[] | undefined,
  runJobs: JobRun[],
  options: {
    showAllPaths: boolean
    viewRef?: SummaryViewRef
    eventType?: string
    runStatus?: PipelineRun['status']
  },
): PipelineGraphJob[] {
  if (!configJobs?.length) {
    return runJobs.map((job) => ({
      name: job.job_name,
      runs_on: job.runs_on,
      needs: job.needs ?? [],
      status:
        options.runStatus === 'cancelled' &&
        (job.status === 'running' || job.status === 'queued')
          ? 'cancelled'
          : job.status,
      job_id: job.id,
      step_count: job.steps?.length ?? job.metrics_json?.steps.length,
    }))
  }

  const previewJobs = options.showAllPaths
    ? configJobs
    : filterJobsForViewRef(configJobs, options.viewRef, options.eventType ?? 'push')

  const names = new Set(previewJobs.map((job) => job.name))
  const runByName = new Map(runJobs.map((job) => [job.job_name, job]))

  return previewJobs.map((job) => {
    const runJob = runByName.get(job.name)
    if (runJob) {
      const status =
        options.runStatus === 'cancelled' &&
        (runJob.status === 'running' || runJob.status === 'queued')
          ? 'cancelled'
          : runJob.status
      return {
        name: job.name,
        runs_on: job.runs_on,
        needs: job.needs.filter((dep) => names.has(dep)),
        status,
        job_id: runJob.id,
        step_count: job.step_count ?? runJob.steps?.length ?? runJob.metrics_json?.steps.length,
      }
    }
    return {
      name: job.name,
      runs_on: job.runs_on,
      needs: job.needs.filter((dep) => names.has(dep)),
      status: 'skipped',
      step_count: job.step_count,
    }
  })
}
