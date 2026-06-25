import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { parseGroupRoute } from '../lib/groupRoute'

export function useGroupNav() {
  const location = useLocation()
  const { token, user } = useAuth()

  const route = useMemo(() => parseGroupRoute(location.pathname), [location.pathname])

  const { data: groups = [] } = useQuery({
    queryKey: ['organizations'],
    queryFn: () => api.listOrganizations(token!),
    enabled: Boolean(token && route),
  })

  const { data: members = [] } = useQuery({
    queryKey: ['org-members', route?.orgSlug],
    queryFn: () => api.listOrganizationMembers(token!, route!.orgSlug),
    enabled: Boolean(token && route),
    staleTime: 60_000,
  })

  if (!route) return null

  const group = groups.find((g) => g.slug === route.orgSlug)
  const myRole = members.find((member) => member.user.id === user?.id)?.role
  const canViewAudit = myRole === 'owner' || myRole === 'admin'

  return {
    ...route,
    groupName: group?.name ?? route.orgSlug,
    canViewAudit,
  }
}
