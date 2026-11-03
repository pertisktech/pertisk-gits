import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { findGroupByPath } from '../lib/groupPath'
import { parseGroupRoute } from '../lib/groupRoute'

export function useGroupFromRoute() {
  const location = useLocation()
  const { token } = useAuth()

  const route = useMemo(() => parseGroupRoute(location.pathname), [location.pathname])
  const orgPath = route?.orgPath ?? ''

  const { data: groups = [] } = useQuery({
    queryKey: ['organizations', token ?? 'public'],
    queryFn: () => api.listOrganizations(token),
    enabled: Boolean(orgPath),
  })

  const group = findGroupByPath(groups, orgPath)

  return { route, orgPath, group, groups }
}
