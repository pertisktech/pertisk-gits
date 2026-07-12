import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { findGroupByPath, isOrganizationMember } from '../lib/groupPath'
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

  const orgPath = route?.orgPath ?? ''
  const group = findGroupByPath(groups, orgPath)
  const isMember = isOrganizationMember(group)

  const { data: members = [] } = useQuery({
    queryKey: ['org-members', orgPath],
    queryFn: () => api.listOrganizationMembers(token!, orgPath),
    enabled: Boolean(token && orgPath && isMember),
    staleTime: 60_000,
    retry: false,
  })

  if (!route) return null

  const myRole = members.find((member) => member.user.id === user?.id)?.role
  const canViewAudit = myRole === 'owner' || myRole === 'admin'
  const canManage = canViewAudit

  return {
    ...route,
    orgSlug: orgPath,
    groupName: group?.name ?? orgPath,
    canViewAudit,
    canManage,
  }
}
