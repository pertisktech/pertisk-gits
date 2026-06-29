import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { api } from '../api/client'
import { buildPipelineRunIndex } from '../lib/pipelineRunIndex'

export function useRepoPipelineRunsIndex(
  orgSlug: string,
  repoSlug: string,
  token?: string | null,
) {
  const { data: runs = [], isLoading } = useQuery({
    queryKey: ['pipeline-runs', orgSlug, repoSlug, token ?? 'public'],
    queryFn: () => api.listPipelineRuns(token!, orgSlug, repoSlug),
    enabled: Boolean(token && orgSlug && repoSlug),
    staleTime: 30_000,
  })

  const index = useMemo(() => buildPipelineRunIndex(runs), [runs])

  return { index, isLoading }
}
