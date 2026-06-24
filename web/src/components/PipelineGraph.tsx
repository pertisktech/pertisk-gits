import { memo, useMemo } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Cpu, Loader2 } from 'lucide-react'
import type { JobRun } from '../api/types'
import {
  graphHeight,
  layoutPipelineGraph,
  type PipelineGraphJob,
  type PipelineGraphNodeData,
} from '../lib/pipelineGraphLayout'

const STATUS_DOT: Record<string, string> = {
  success: 'ci-status-dot-success',
  failure: 'ci-status-dot-failure',
  running: 'ci-status-dot-active',
  queued: 'ci-status-dot-active',
}

function PipelineJobNode({ data }: NodeProps) {
  const nodeData = data as PipelineGraphNodeData
  const { job, selected } = nodeData
  const status = job.status ?? 'preview'
  const dotClass = STATUS_DOT[status] ?? ''

  return (
    <button
      type="button"
      className={`pipeline-graph-node${selected ? ' pipeline-graph-node--selected' : ''}`}
      onClick={() => nodeData.onSelect?.(job.job_id ?? job.name)}
    >
      <Handle type="target" position={Position.Left} className="pipeline-graph-handle" />
      <div className="pipeline-graph-node-header">
        <span className={`ci-status-dot${dotClass ? ` ${dotClass}` : ''}`} />
        <Cpu size={12} className="pipeline-graph-node-icon" />
        <span className="pipeline-graph-node-name">{job.name}</span>
      </div>
      <div className="pipeline-graph-node-meta">
        <span className="pipeline-graph-node-label">{job.runs_on}</span>
        {job.step_count !== undefined && (
          <span className="pipeline-graph-node-steps">{job.step_count} steps</span>
        )}
      </div>
      <Handle type="source" position={Position.Right} className="pipeline-graph-handle" />
    </button>
  )
}

const nodeTypes = { pipelineJob: memo(PipelineJobNode) }

export function jobsFromRun(jobs: JobRun[]): PipelineGraphJob[] {
  return jobs.map((job) => ({
    name: job.job_name,
    runs_on: job.runs_on,
    needs: job.needs ?? [],
    status: job.status,
    job_id: job.id,
    step_count: job.steps?.length ?? job.metrics_json?.steps.length,
  }))
}

export function PipelineGraph({
  jobs,
  selectedJob,
  onJobSelect,
  loading,
  emptyMessage = 'No jobs defined',
  className,
}: {
  jobs: PipelineGraphJob[]
  selectedJob?: string | null
  onJobSelect?: (jobKey: string) => void
  loading?: boolean
  emptyMessage?: string
  className?: string
}) {
  const height = graphHeight(jobs)

  const layout = useMemo(
    () => layoutPipelineGraph(jobs, { selectedJob }),
    [jobs, selectedJob],
  )

  const nodes = useMemo(
    () =>
      layout.nodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          selected:
            selectedJob === node.id ||
            selectedJob === node.data.job.job_id ||
            node.data.selected,
          onSelect: onJobSelect,
        },
      })),
    [layout.nodes, onJobSelect, selectedJob],
  )

  const graphKey = useMemo(
    () => jobs.map((job) => `${job.name}:${job.status ?? 'preview'}`).join('|'),
    [jobs],
  )

  if (loading) {
    return (
      <div className={`pipeline-graph-panel${className ? ` ${className}` : ''}`} style={{ height }}>
        <div className="pipeline-graph-empty">
          <Loader2 size={16} className="animate-spin" />
          Loading pipeline graph…
        </div>
      </div>
    )
  }

  if (jobs.length === 0) {
    return (
      <div className={`pipeline-graph-panel${className ? ` ${className}` : ''}`} style={{ height: 160 }}>
        <div className="pipeline-graph-empty">{emptyMessage}</div>
      </div>
    )
  }

  return (
    <div className={`pipeline-graph-panel${className ? ` ${className}` : ''}`} style={{ height }}>
      <ReactFlow
        key={graphKey}
        nodes={nodes}
        edges={layout.edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1.2 }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnScroll
        zoomOnScroll
        minZoom={0.35}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="var(--color-border)" />
        <Controls showInteractive={false} className="pipeline-graph-controls" />
      </ReactFlow>
    </div>
  )
}
