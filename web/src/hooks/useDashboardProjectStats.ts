import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { api } from '../api/client'
import type { DashboardProjectStats } from '../api/types'
import { useEffectiveAuthToken } from '../auth/AuthContext'
export interface ProjectStatsRef {
  orgSlug: string
  slug: string
}

function statsKey(project: ProjectStatsRef) {
  return `${project.orgSlug}/${project.slug}`
}

export function useDashboardProjectStats(projects: ProjectStatsRef[]) {
  const token = useEffectiveAuthToken()

  const payload = useMemo(
    () =>
      projects.map((project) => ({
        org_path: project.orgSlug,
        slug: project.slug,
      })),
    [projects],
  )

  const queryKey = useMemo(
    () => ['dashboard-project-stats', payload.map((p) => `${p.org_path}/${p.slug}`).join('|')],
    [payload],
  )

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => api.getDashboardProjectStats(token!, payload),
    enabled: Boolean(token) && payload.length > 0,
    staleTime: 60_000,
  })

  const statsByKey = useMemo(() => {
    const map = new Map<string, DashboardProjectStats>()
    for (const stat of data?.stats ?? []) {
      map.set(`${stat.org_path}/${stat.slug}`, stat)
    }
    return map
  }, [data?.stats])

  return {
    isLoading,
    getStats: (project: ProjectStatsRef) => statsByKey.get(statsKey(project)),
  }
}
