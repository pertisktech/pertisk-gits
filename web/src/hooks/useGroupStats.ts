import { useQueries } from '@tanstack/react-query'
import { useMemo } from 'react'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import type { Organization } from '../api/types'
import { groupUrlPath } from '../lib/groupPath'

export function useGroupStats(groups: Organization[], allGroups: Organization[]) {
  const { token } = useAuth()

  const repoQueries = useQueries({
    queries: groups.map((group) => ({
      queryKey: ['repositories', groupUrlPath(group)],
      queryFn: () => api.listRepositories(token!, groupUrlPath(group)),
      enabled: Boolean(token && groups.length > 0),
    })),
  })

  const statsByGroupId = useMemo(() => {
    const map = new Map<string, { subgroups: number; projects: number }>()
    groups.forEach((group, index) => {
      map.set(group.id, {
        subgroups: allGroups.filter((item) => item.parent_id === group.id).length,
        projects: repoQueries[index]?.data?.length ?? 0,
      })
    })
    return map
  }, [groups, allGroups, repoQueries])

  const isLoading = groups.length > 0 && repoQueries.some((query) => query.isLoading)

  return { statsByGroupId, isLoading }
}
