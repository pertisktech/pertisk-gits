import { useQueries } from '@tanstack/react-query'
import { useMemo } from 'react'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import type { Organization } from '../api/types'
import { groupUrlPath } from '../lib/groupPath'

export function useTopLevelGroupStats(groups: Organization[]) {
  const { token } = useAuth()

  const topLevelGroups = useMemo(
    () => groups.filter((group) => !group.parent_id),
    [groups],
  )

  const repoQueries = useQueries({
    queries: topLevelGroups.map((group) => ({
      queryKey: ['repositories', groupUrlPath(group)],
      queryFn: () => api.listRepositories(token!, groupUrlPath(group)),
      enabled: Boolean(token),
    })),
  })

  const statsByGroupId = useMemo(() => {
    const map = new Map<string, { subgroups: number; projects: number }>()
    topLevelGroups.forEach((group, index) => {
      map.set(group.id, {
        subgroups: groups.filter((item) => item.parent_id === group.id).length,
        projects: repoQueries[index]?.data?.length ?? 0,
      })
    })
    return map
  }, [groups, topLevelGroups, repoQueries])

  const isLoading = repoQueries.some((query) => query.isLoading)

  return { topLevelGroups, statsByGroupId, isLoading }
}
