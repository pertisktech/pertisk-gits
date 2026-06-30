import type { PipelineRun } from '../api/types'

function isNewerRun(candidate: PipelineRun, existing: PipelineRun) {
  return Date.parse(candidate.created_at) > Date.parse(existing.created_at)
}

export interface PipelineRunIndex {
  bySha: Map<string, PipelineRun>
  byRef: Map<string, PipelineRun>
}

export function buildPipelineRunIndex(runs: PipelineRun[]): PipelineRunIndex {
  const bySha = new Map<string, PipelineRun>()
  const byRef = new Map<string, PipelineRun>()

  for (const run of runs) {
    const existingSha = bySha.get(run.commit_sha)
    if (!existingSha || isNewerRun(run, existingSha)) {
      bySha.set(run.commit_sha, run)
    }

    const existingRef = byRef.get(run.ref_name)
    if (!existingRef || isNewerRun(run, existingRef)) {
      byRef.set(run.ref_name, run)
    }
  }

  return { bySha, byRef }
}

export function pipelineRunForCommit(index: PipelineRunIndex, commitSha: string) {
  return index.bySha.get(commitSha)
}

export function pipelineRunForTag(index: PipelineRunIndex, tagName: string, commitSha: string) {
  return index.byRef.get(`refs/tags/${tagName}`) ?? index.bySha.get(commitSha)
}

export function pipelineRunForBranch(
  index: PipelineRunIndex,
  branchName: string,
  commitSha: string,
) {
  return index.byRef.get(`refs/heads/${branchName}`) ?? index.bySha.get(commitSha)
}
