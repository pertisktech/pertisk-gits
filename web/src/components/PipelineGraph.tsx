import { memo, useMemo, type MouseEvent } from 'react'
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
import { Cpu, Loader2, Play } from 'lucide-react'
import type { JobRun, PipelineRun } from '../api/types'
import {
  graphHeight,
  layoutPipelineGraph,
  type PipelineGraphJob,
  type PipelineGraphNodeData,
} from '../lib/pipelineGraphLayout'
import { ActionsStatusIcon } from './PipelineStatus'

function PipelineJobNode({ data }: NodeProps) {
  const nodeData = data as PipelineGraphNodeData
  const { job, selected, canPlay, onPlay } = nodeData
  const status = job.status ?? 'pending'
  const isManual = status === 'manual'

  return (
    <div
      className={`pipeline-graph-node-wrap${selected ? ' pipeline-graph-node-wrap--selected' : ''}${status === 'skipped' ? ' pipeline-graph-node-wrap--skipped' : ''}${isManual ? ' pipeline-graph-node-wrap--manual' : ''}`}
    >
      <button
        type="button"
        className={`pipeline-graph-node nodrag nopan${selected ? ' pipeline-graph-node--selected' : ''}${status === 'skipped' ? ' pipeline-graph-node--skipped' : ''}${isManual ? ' pipeline-graph-node--manual' : ''}`}
        onClick={(event) => {
          event.stopPropagation()
          nodeData.onSelect?.(job.job_id ?? job.name)
        }}
      >
        <Handle type="target" position={Position.Left} className="pipeline-graph-handle" />
        <div className="pipeline-graph-node-header">
          <ActionsStatusIcon status={status} size="sm" />
          <Cpu size={12} className="pipeline-graph-node-icon" />
          <span className="pipeline-graph-node-name">{job.name}</span>
        </div>
        <div className="pipeline-graph-node-meta">
          <span className="pipeline-graph-node-label">{job.runs_on}</span>
          {isManual ? (
            <span className="pipeline-graph-node-steps">manual</span>
          ) : (
            job.step_count !== undefined && (
              <span className="pipeline-graph-node-steps">{job.step_count} steps</span>
            )
          )}
        </div>
        <Handle type="source" position={Position.Right} className="pipeline-graph-handle" />
      </button>
      {isManual && canPlay && onPlay && (
        <button
          type="button"
          className="pipeline-graph-node-play"
          title="Run manual job"
          aria-label={`Run ${job.name}`}
          onClick={(event) => {
            event.stopPropagation()
            onPlay(job.job_id ?? job.name)
          }}
        >
          <Play size={14} />
        </button>
      )}
    </div>
  )
}

const nodeTypes = { pipelineJob: memo(PipelineJobNode) }

export function jobsFromRun(
  jobs: JobRun[],
  runStatus?: PipelineRun['status'],
): PipelineGraphJob[] {
  return jobs.map((job) => ({
    name: job.job_name,
    runs_on: job.runs_on,
    needs: job.needs ?? [],
    status: runStatus === 'cancelled' && (job.status === 'running' || job.status === 'queued')
      ? 'cancelled'
      : job.status,
    job_id: job.id,
    step_count: job.steps?.length ?? job.metrics_json?.steps.length,
  }))
}

export function PipelineGraph({
  jobs,
  selectedJob,
  onJobSelect,
  onPlayJob,
  canPlayJob,
  loading,
  emptyMessage = 'No jobs defined',
  className,
}: {
  jobs: PipelineGraphJob[]
  selectedJob?: string | null
  onJobSelect?: (jobKey: string) => void
  onPlayJob?: (jobKey: string) => void
  canPlayJob?: (job: PipelineGraphJob) => boolean
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
          onPlay: onPlayJob,
          canPlay: canPlayJob?.(node.data.job) ?? false,
        },
      })),
    [layout.nodes, onJobSelect, onPlayJob, canPlayJob, selectedJob],
  )

  const structureKey = useMemo(
    () => jobs.map((job) => job.name).sort().join('|'),
    [jobs],
  )

  const handleNodeClick = useMemo(
    () =>
      onJobSelect
        ? (_event: MouseEvent, node: { id: string; data: PipelineGraphNodeData }) => {
            onJobSelect(node.data.job.job_id ?? node.id)
          }
        : undefined,
    [onJobSelect],
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
        key={structureKey}
        nodes={nodes}
        edges={layout.edges}
        nodeTypes={nodeTypes}
        onNodeClick={handleNodeClick}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1.2 }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        nodesFocusable={false}
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
