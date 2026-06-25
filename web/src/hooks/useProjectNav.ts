import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { parseProjectRoute } from '../lib/projectRoute'

export function useProjectNav() {
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const { token } = useAuth()

  const route = useMemo(
    () => parseProjectRoute(location.pathname, searchParams),
    [location.pathname, searchParams],
  )

  const { data: repoData } = useQuery({
    queryKey: ['repository', route?.orgSlug, route?.projectSlug, token ?? 'public'],
    queryFn: () => api.getRepository(route!.orgSlug, route!.projectSlug, token),
    enabled: Boolean(route),
  })

  const project = repoData?.repository

  const showPipelinesTab = Boolean(token && route)

  if (!route) return null

  let tab = route.tab
  if (tab === 'pipelines' && !token) {
    tab = 'code'
  }
  if (tab === 'settings' && !token) {
    tab = 'code'
  }

  return {
    ...route,
    tab,
    projectName: project?.name ?? route.projectSlug,
    showPipelinesTab,
    showSettingsTab: Boolean(token),
  }
}
