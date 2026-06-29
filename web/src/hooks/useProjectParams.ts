import { useMemo } from 'react'
import { useLocation, useParams, useSearchParams } from 'react-router-dom'
import { parseProjectRoute } from '../lib/projectRoute'

const RESERVED_PROJECT_SLUGS = new Set(['new'])

/** Org path + repo slug for `/groups/{org}/projects/{repo}` routes. */
export function useProjectParams() {
  const params = useParams()
  const { pathname } = useLocation()
  const [searchParams] = useSearchParams()

  return useMemo(() => {
    const parsed = parseProjectRoute(pathname, searchParams)
    if (parsed) {
      return { orgSlug: parsed.orgSlug, projectSlug: parsed.projectSlug }
    }

    const projectSlug = params.projectSlug ?? ''
    const orgSlug = (params['*'] ?? '').replace(/\/$/, '')
    if (!orgSlug || !projectSlug || RESERVED_PROJECT_SLUGS.has(projectSlug)) {
      return { orgSlug: '', projectSlug: '' }
    }
    return { orgSlug, projectSlug }
  }, [params, pathname, searchParams])
}
