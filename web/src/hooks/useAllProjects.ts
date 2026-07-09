import { useQueries, useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { api } from '../api/client'
import { useEffectiveAuthToken } from '../auth/AuthContext'
import type { Repository } from '../api/types'
import { groupUrlPath } from '../lib/groupPath'

export interface DashboardProject extends Repository {
  orgSlug: string
  orgName: string
}

export function useAllProjects() {
  const token = useEffectiveAuthToken()

  const {
    data: groups = [],
    isLoading: groupsLoading,
    error: groupsError,
  } = useQuery({
    queryKey: ['organizations'],
    queryFn: () => api.listOrganizations(token!),
    enabled: Boolean(token),
  })

  const repoQueries = useQueries({
    queries: groups.map((group) => ({
      queryKey: ['repositories', groupUrlPath(group)],
      queryFn: () => api.listRepositories(token!, groupUrlPath(group)),
      enabled: Boolean(token),
    })),
  })

  const projects = useMemo((): DashboardProject[] => {
    const items: DashboardProject[] = []
    groups.forEach((group, index) => {
      for (const repo of repoQueries[index]?.data ?? []) {
        items.push({
          ...repo,
          orgSlug: groupUrlPath(group),
          orgName: group.name,
        })
      }
    })
    return items
  }, [groups, repoQueries])

  const isLoading = groupsLoading || repoQueries.some((query) => query.isLoading)

  const error = groupsError ?? repoQueries.find((query) => query.error)?.error ?? null

  return { projects, groups, isLoading, error }
}
