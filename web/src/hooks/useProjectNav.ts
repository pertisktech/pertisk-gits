import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { PIPELINE_CONFIG_FILES } from '../components/RepoPipelines'
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

  const { data: browserData } = useQuery({
    queryKey: ['repo-browser', route?.orgSlug, route?.projectSlug],
    queryFn: () => api.getRepoBrowser(route!.orgSlug, route!.projectSlug, token),
    enabled: Boolean(route),
  })

  const project = repoData?.repository
  const repoEmpty = browserData?.browser.empty ?? false

  const { data: hasPipelineConfig = false, isLoading: pipelineConfigLoading } = useQuery({
    queryKey: ['pipeline-config', route?.orgSlug, route?.projectSlug, project?.default_branch],
    queryFn: async () => {
      const tree = await api.getRepoTree(
        route!.orgSlug,
        route!.projectSlug,
        { ref: project!.default_branch },
        token,
      )
      return tree.entries.some(
        (entry) => PIPELINE_CONFIG_FILES.has(entry.name) && entry.kind === 'blob',
      )
    },
    enabled: Boolean(token && route && project && browserData && !repoEmpty),
  })

  const showPipelinesTab = Boolean(token && route && !repoEmpty && hasPipelineConfig)

  if (!route) return null

  let tab = route.tab
  if (tab === 'pipelines' && !showPipelinesTab && !pipelineConfigLoading) {
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
