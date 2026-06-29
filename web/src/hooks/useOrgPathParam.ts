import { useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import { parseGroupRoute } from '../lib/groupRoute'
import { parseNewProjectRoute, parseProjectRoute } from '../lib/projectRoute'

/** Group full path from the current URL (e.g. `gitlab` or `a/b/c`). */
export function useOrgPathParam(): string {
  const { pathname } = useLocation()

  return useMemo(() => {
    const group = parseGroupRoute(pathname)
    if (group?.orgPath) return group.orgPath

    const newProject = parseNewProjectRoute(pathname)
    if (newProject) return newProject.orgPath

    const project = parseProjectRoute(pathname, new URLSearchParams())
    if (project) return project.orgSlug

    return ''
  }, [pathname])
}
