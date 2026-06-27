import { useQueries } from '@tanstack/react-query'
import { useMemo } from 'react'
import { api } from '../api/client'
import type { PullRequestDetail } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { useAllProjects } from './useAllProjects'

export interface ActivityPullRequest extends PullRequestDetail {
  orgSlug: string
  orgName: string
  repoSlug: string
  repoName: string
}

export function useAllOpenPullRequests() {
  const { token } = useAuth()
  const { projects, isLoading: projectsLoading, error: projectsError } = useAllProjects()

  const pullQueries = useQueries({
    queries: projects.map((project) => ({
      queryKey: ['repo-pulls', project.orgSlug, project.slug, 'open', token],
      queryFn: () =>
        api.listPullRequests(project.orgSlug, project.slug, { state: 'open' }, token!),
      enabled: Boolean(token),
      staleTime: 30_000,
    })),
  })

  const pullRequests = useMemo((): ActivityPullRequest[] => {
    const items: ActivityPullRequest[] = []
    projects.forEach((project, index) => {
      const data = pullQueries[index]?.data
      if (!data) return
      for (const entry of data.pull_requests) {
        items.push({
          ...entry,
          orgSlug: project.orgSlug,
          orgName: project.orgName,
          repoSlug: project.slug,
          repoName: project.name,
        })
      }
    })
    return items.sort(
      (a, b) =>
        new Date(b.pull_request.updated_at).getTime() -
        new Date(a.pull_request.updated_at).getTime(),
    )
  }, [projects, pullQueries])

  const isLoading =
    projectsLoading || pullQueries.some((query) => query.isLoading)

  const error =
    projectsError ?? pullQueries.find((query) => query.error)?.error ?? null

  return { pullRequests, isLoading, error }
}
