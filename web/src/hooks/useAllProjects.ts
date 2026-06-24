import { useQueries, useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import type { Repository } from '../api/types'

export interface DashboardProject extends Repository {
  orgSlug: string
  orgName: string
  /** Unix seconds; null when repo is empty or commit fetch failed */
  lastCommittedAt: number | null
  lastCommitLoading: boolean
}

async function fetchLastCommitAt(
  orgSlug: string,
  repoSlug: string,
  defaultBranch: string,
  token: string,
): Promise<number | null> {
  try {
    const { commits } = await api.getRepoCommits(
      orgSlug,
      repoSlug,
      { ref: defaultBranch, limit: 1 },
      token,
    )
    return commits[0]?.committed_at ?? null
  } catch {
    return null
  }
}

export function useAllProjects() {
  const { token } = useAuth()

  const {
    data: groups = [],
    isLoading: groupsLoading,
    error: groupsError,
  } = useQuery({
    queryKey: ['organizations'],
    queryFn: () => api.listOrganizations(token!),
    enabled: Boolean(token),
  })

  const repoQueries = useQueries({
    queries: groups.map((group) => ({
      queryKey: ['repositories', group.slug],
      queryFn: () => api.listRepositories(token!, group.slug),
      enabled: Boolean(token),
    })),
  })

  const baseProjects = useMemo(() => {
    const items: Array<Repository & { orgSlug: string; orgName: string }> = []
    groups.forEach((group, index) => {
      for (const repo of repoQueries[index]?.data ?? []) {
        items.push({
          ...repo,
          orgSlug: group.slug,
          orgName: group.name,
        })
      }
    })
    return items
  }, [groups, repoQueries])

  const commitQueries = useQueries({
    queries: baseProjects.map((project) => ({
      queryKey: [
        'repo-last-commit',
        project.orgSlug,
        project.slug,
        project.default_branch,
      ],
      queryFn: () =>
        fetchLastCommitAt(
          project.orgSlug,
          project.slug,
          project.default_branch,
          token!,
        ),
      enabled: Boolean(token),
      staleTime: 60_000,
    })),
  })

  const projects = useMemo((): DashboardProject[] => {
    return baseProjects.map((project, index) => ({
      ...project,
      lastCommittedAt: commitQueries[index]?.data ?? null,
      lastCommitLoading: commitQueries[index]?.isLoading ?? false,
    }))
  }, [baseProjects, commitQueries])

  const isLoading =
    groupsLoading ||
    repoQueries.some((query) => query.isLoading) ||
    commitQueries.some((query) => query.isLoading)

  const error = groupsError ?? repoQueries.find((query) => query.error)?.error ?? null

  return { projects, isLoading, error }
}
