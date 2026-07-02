import type { MouseEvent } from 'react'
import { Link } from 'react-router-dom'
import type { PipelineRun } from '../api/types'
import { displayRunStatusIcon, formatPipelineIid } from '../lib/pipelineStatus'
import { ActionsStatusIcon } from './PipelineStatus'

export function PipelineRunStatusLink({
  run,
  orgSlug,
  repoSlug,
}: {
  run?: PipelineRun
  orgSlug: string
  repoSlug: string
}) {
  if (!run) return null

  const status = displayRunStatusIcon(run)
  const label = `Pipeline ${formatPipelineIid(run.pipeline_iid)} ${status}`

  function stopNavigation(event: MouseEvent) {
    event.stopPropagation()
  }

  return (
    <Link
      to={`/groups/${orgSlug}/projects/${repoSlug}/pipelines/${run.id}`}
      className="commit-history-pipeline"
      title={label}
      aria-label={label}
      onClick={stopNavigation}
    >
      <ActionsStatusIcon status={status} size="sm" />
    </Link>
  )
}
