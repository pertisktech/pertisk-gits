import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { parseGroupRoute } from '../lib/groupRoute'

export function useGroupNav() {
  const location = useLocation()
  const { token } = useAuth()

  const route = useMemo(() => parseGroupRoute(location.pathname), [location.pathname])

  const { data: groups = [] } = useQuery({
    queryKey: ['organizations'],
    queryFn: () => api.listOrganizations(token!),
    enabled: Boolean(token && route),
  })

  if (!route) return null

  const group = groups.find((g) => g.slug === route.orgSlug)

  return {
    ...route,
    groupName: group?.name ?? route.orgSlug,
  }
}
