import { ChevronDown, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import type { PipelineConfigPreview } from '../api/types'
import {
  inferPipelinePaths,
  pipelineSummaryNeedsJobFilter,
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

function PathRow({ path }: { path: ReturnType<typeof inferPipelinePaths>[number] }) {
  const [open, setOpen] = useState(false)

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

export function PipelineSummary({ config }: { config: PipelineConfigPreview }) {
  const [open, setOpen] = useState(false)
  const paths = inferPipelinePaths(config)
  const needsFilter = pipelineSummaryNeedsJobFilter(config)

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
        <span className="pipeline-summary-badge">
          {paths.length} path{paths.length === 1 ? '' : 's'}
        </span>
      </button>

      {open && (
        <div className="pipeline-summary-body">
          <p className="pipeline-summary-subtitle">
            Every branch runs the shared build chain (unit-test, build-docker, …). Deploy jobs run
            when their <code className="font-mono text-xs">if:</code> matches the branch, tag, and
            trigger.
          </p>

          <div className="pipeline-summary-paths">
            {paths.map((path) => (
              <PathRow key={path.id} path={path} />
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
