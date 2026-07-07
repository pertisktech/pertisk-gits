import { useQueries } from '@tanstack/react-query'
import { useMemo } from 'react'
import { api } from '../api/client'
import type { DashboardProjectStats } from '../api/types'
import { useEffectiveAuthToken } from '../auth/AuthContext'

export interface ProjectStatsRef {
  orgSlug: string
  slug: string
}

const MAX_STATS_BATCH = 50

function statsKey(project: ProjectStatsRef) {
  return `${project.orgSlug}/${project.slug}`
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
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

  const batches = useMemo(() => chunk(payload, MAX_STATS_BATCH), [payload])

  const queries = useQueries({
    queries: batches.map((batch) => ({
      queryKey: ['dashboard-project-stats', batch.map((p) => `${p.org_path}/${p.slug}`).join('|')],
      queryFn: () => api.getDashboardProjectStats(token!, batch),
      enabled: Boolean(token) && batch.length > 0,
      staleTime: 60_000,
    })),
  })

  const statsByKey = useMemo(() => {
    const map = new Map<string, DashboardProjectStats>()
    for (const query of queries) {
      for (const stat of query.data?.stats ?? []) {
        map.set(`${stat.org_path}/${stat.slug}`, stat)
      }
    }
    return map
  }, [queries])

  const isLoading = batches.length > 0 && queries.some((query) => query.isLoading)

  return {
    isLoading,
    getStats: (project: ProjectStatsRef) => statsByKey.get(statsKey(project)),
  }
}
