import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'

export interface CommitPullRequestMatch {
  pullNumber: number
  title: string
  sourceBranch: string
  targetBranch: string
}

export function useCommitPullRequest(
  orgSlug: string,
  repoSlug: string,
  commitSha: string,
  token?: string | null,
) {
  return useQuery({
    queryKey: ['commit-pull-request', orgSlug, repoSlug, commitSha, token ?? ''],
    queryFn: async (): Promise<CommitPullRequestMatch | null> => {
      const pullsData = await api.listPullRequests(orgSlug, repoSlug, { state: 'open' }, token)
      for (const item of pullsData.pull_requests.slice(0, 25)) {
        const pr = item.pull_request
        try {
          const compare = await api.getPullRequestCompare(orgSlug, repoSlug, pr.number, token)
          if (compare.commits.some((commit) => commit.sha === commitSha)) {
            return {
              pullNumber: pr.number,
              title: pr.title,
              sourceBranch: pr.source_branch,
              targetBranch: pr.target_branch,
            }
          }
        } catch {
          // branch may have been deleted; skip
        }
      }
      return null
    },
    enabled: Boolean(orgSlug && repoSlug && commitSha && token),
    staleTime: 60_000,
  })
}
