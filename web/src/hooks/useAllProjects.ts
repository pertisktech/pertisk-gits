import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { api } from '../api/client'
import { useEffectiveAuthToken } from '../auth/AuthContext'
import type { Repository } from '../api/types'

export interface DashboardProject extends Repository {
  orgSlug: string
  orgName: string
}

export function useAllProjects() {
  const token = useEffectiveAuthToken()

  const {
    data: repos = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ['accessible-repositories'],
    queryFn: () => api.listAccessibleRepositories(token!),
    enabled: Boolean(token),
  })

  const projects = useMemo((): DashboardProject[] => {
    return repos.map((repo) => {
      const orgSlug = repo.organization_path ?? ''
      const orgName =
        repo.organization_name ??
        orgSlug.split('/').filter(Boolean).pop() ??
        orgSlug
      return {
        ...repo,
        orgSlug,
        orgName,
      }
    })
  }, [repos])

  return { projects, isLoading, error }
}
