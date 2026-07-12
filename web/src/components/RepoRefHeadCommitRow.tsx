import { Link } from 'react-router-dom'
import type { CommitInfo, PipelineRun } from '../api/types'
import { useRepoPipelineRunsIndex } from '../hooks/useRepoPipelineRunsIndex'
import { pipelineRunForBranch, pipelineRunForTag } from '../lib/pipelineRunIndex'
import { displayRunStatusIcon, formatPipelineIid } from '../lib/pipelineStatus'
import { ActionsStatusIcon, PipelineRunStatusBadge } from './PipelineStatus'
import { RepoRefHeadSummary } from './RepoRefHeadSummary'

export function RepoRefHeadCommitRow({
  orgSlug,
  repoSlug,
  token,
  refKind,
  activeRef,
  commit,
}: {
  orgSlug: string
  repoSlug: string
  token?: string | null
  refKind: 'branch' | 'tag'
  activeRef: string
  commit: CommitInfo
}) {
  const { index } = useRepoPipelineRunsIndex(orgSlug, repoSlug, token)

  const pipelineRun =
    refKind === 'tag'
      ? pipelineRunForTag(index, activeRef, commit.sha)
      : pipelineRunForBranch(index, activeRef, commit.sha)

  return (
    <>
      <RepoRefHeadSummary orgSlug={orgSlug} repoSlug={repoSlug} commit={commit} />
      {pipelineRun ? (
        <RepoRefPipelineStatus run={pipelineRun} orgSlug={orgSlug} repoSlug={repoSlug} />
      ) : null}
    </>
  )
}

function RepoRefPipelineStatus({
  run,
  orgSlug,
  repoSlug,
}: {
  run: PipelineRun
  orgSlug: string
  repoSlug: string
}) {
  const status = displayRunStatusIcon(run)
  const label = `Pipeline ${formatPipelineIid(run.pipeline_iid)}`

  return (
    <Link
      to={`/groups/${orgSlug}/projects/${repoSlug}/pipelines/${run.id}`}
      className="app-ref-head-pipeline"
      title={`${label} — ${run.status} (${run.ref_name})`}
    >
      <ActionsStatusIcon status={status} size="sm" />
      <span className="app-ref-head-pipeline-label">{label}</span>
      <PipelineRunStatusBadge status={run.status} />
    </Link>
  )
}
