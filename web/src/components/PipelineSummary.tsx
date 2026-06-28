import { ChevronDown, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import type { PipelineConfigPreview } from '../api/types'
import {
  inferPipelinePaths,
  pipelineSummaryNeedsJobFilter,
  type SummaryViewRef,
  viewRefLabel,
} from '../lib/pipelineSummary'
import { cn } from '../utils/cn'

function JobFlow({ jobs }: { jobs: string[] }) {
  if (jobs.length === 0) return null

  return (
    <div className="pipeline-summary-flow">
      {jobs.map((job, index) => (
        <span key={job} className="pipeline-summary-flow-item">
          {index > 0 && (
            <span className="pipeline-summary-flow-arrow" aria-hidden>
              →
            </span>
          )}
          <span className="pipeline-summary-job">{job}</span>
        </span>
      ))}
    </div>
  )
}

function PathRow({
  path,
  defaultOpen,
}: {
  path: ReturnType<typeof inferPipelinePaths>[number]
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen ?? false)

  return (
    <div className={cn('pipeline-summary-path', open && 'pipeline-summary-path--open')}>
      <button
        type="button"
        className="pipeline-summary-path-toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="pipeline-summary-path-chevron" aria-hidden>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
        <span className="pipeline-summary-path-branch">{path.title}</span>
        <span
          className={cn(
            'pipeline-summary-path-trigger',
            path.automatic && 'pipeline-summary-path-trigger--auto',
          )}
        >
          {path.triggerLabel}
        </span>
        <span className="pipeline-summary-path-count">
          {path.jobs.length} job{path.jobs.length === 1 ? '' : 's'}
        </span>
      </button>

      {open && (
        <div className="pipeline-summary-path-body">
          <div className="pipeline-summary-path-section">
            <span className="pipeline-summary-path-section-label">Build</span>
            <JobFlow jobs={path.buildJobs} />
          </div>
          {path.deployJobs.length > 0 && (
            <div className="pipeline-summary-path-section">
              <span className="pipeline-summary-path-section-label">Deploy</span>
              <JobFlow jobs={path.deployJobs} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function PipelineSummary({
  config,
  viewRef,
  showAllPaths = true,
  onShowAllPathsChange,
}: {
  config: PipelineConfigPreview
  viewRef?: SummaryViewRef
  showAllPaths?: boolean
  onShowAllPathsChange?: (value: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const paths = inferPipelinePaths(config, { viewRef, showAllPaths })
  const allPathCount = inferPipelinePaths(config, { showAllPaths: true }).length
  const needsFilter = pipelineSummaryNeedsJobFilter(config)
  const viewLabel = viewRefLabel(viewRef)
  const canFilter = Boolean(viewLabel) && allPathCount > 1

  if (paths.length === 0) return null

  return (
    <div className={cn('pipeline-summary', open && 'pipeline-summary--open')}>
      <button
        type="button"
        className="pipeline-summary-toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="pipeline-summary-chevron" aria-hidden>
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </span>
        <span className="pipeline-summary-title">Pipeline summary</span>
        {viewLabel && !showAllPaths && (
          <span className="pipeline-summary-view-ref font-mono">{viewLabel}</span>
        )}
        <span className="pipeline-summary-badge">
          {paths.length} path{paths.length === 1 ? '' : 's'}
        </span>
      </button>

      {open && (
        <div className="pipeline-summary-body">
          <div className="pipeline-summary-toolbar">
            <p className="pipeline-summary-subtitle">
              {showAllPaths || !viewLabel ? (
                <>
                  Shared build chain runs on every branch. Deploy jobs run when their{' '}
                  <code className="font-mono text-xs">if:</code> matches branch, tag, and trigger.
                </>
              ) : (
                <>
                  Showing workflow for <strong className="font-mono text-text">{viewLabel}</strong>
                  . Other deploy paths (e.g. main dev, QA, UAT) are hidden.
                </>
              )}
            </p>
            {canFilter && onShowAllPathsChange && (
              <label className="pipeline-summary-filter">
                <input
                  type="checkbox"
                  checked={showAllPaths}
                  onChange={(event) => onShowAllPathsChange(event.target.checked)}
                />
                Show all branches
              </label>
            )}
          </div>

          <div className="pipeline-summary-paths">
            {paths.map((path) => (
              <PathRow
                key={path.id}
                path={path}
                defaultOpen={paths.length === 1}
              />
            ))}
          </div>

          {needsFilter && (
            <p className="pipeline-summary-note">
              Add <code className="font-mono text-xs">if:</code> on deploy jobs to limit which
              branch or tag runs each environment.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
