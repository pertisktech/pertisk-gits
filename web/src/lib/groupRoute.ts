export type GroupTab = 'repositories' | 'registry' | 'members' | 'teams' | 'roles' | 'machine-users' | 'audit' | 'secrets' | 'import' | 'settings'

const GROUP_PATH = /^\/groups\/([^?#]+)/

/** Static routes under /groups that are not organization paths. */
export const RESERVED_GROUP_SLUGS = new Set(['new'])

const TAB_SUFFIXES: { suffix: string; tab: GroupTab }[] = [
  { suffix: '/registry', tab: 'registry' },
  { suffix: '/members', tab: 'members' },
  { suffix: '/teams', tab: 'teams' },
  { suffix: '/roles', tab: 'roles' },
  { suffix: '/machine-users', tab: 'machine-users' },
  { suffix: '/audit', tab: 'audit' },
  { suffix: '/secrets', tab: 'secrets' },
  { suffix: '/import', tab: 'import' },
  { suffix: '/settings', tab: 'settings' },
]

const REGISTRY_IMAGE_PATH = /^\/groups\/(.+?)\/registry\/([^/]+)\/?$/

export function parseRegistryImageRoute(pathname: string) {
  const match = pathname.match(REGISTRY_IMAGE_PATH)
  if (!match) return null
  return {
    orgPath: match[1].replace(/\/$/, ''),
    imageName: decodeURIComponent(match[2]),
  }
}

export function parseGroupRoute(pathname: string) {
  const match = pathname.match(GROUP_PATH)
  if (!match) return null

  let rest = match[1]
  if (RESERVED_GROUP_SLUGS.has(rest.split('/')[0])) return null

  // Project URLs are handled by projectRoute.ts
  if (rest.includes('/projects/')) return null

  const registryImage = rest.match(/^(.+)\/registry\/([^/]+)$/)
  if (registryImage) {
    const orgPath = registryImage[1].replace(/\/$/, '')
    return { orgPath, orgSlug: orgPath, tab: 'registry' as GroupTab, basePath: `/groups/${orgPath}` }
  }

  let tab: GroupTab = 'repositories'
  for (const { suffix, tab: tabName } of TAB_SUFFIXES) {
    if (rest === suffix.slice(1) || rest.endsWith(suffix)) {
      tab = tabName
      if (rest.endsWith(suffix)) {
        rest = rest.slice(0, -suffix.length).replace(/\/$/, '')
      } else {
        rest = ''
      }
      break
    }
  }

  if (rest.endsWith('/projects/new')) {
    return null
  }

  const orgPath = rest.replace(/\/$/, '')
  if (!orgPath && tab === 'repositories') return null

  const basePath = `/groups/${orgPath}`

  return { orgPath, orgSlug: orgPath, tab, basePath }
}

export function groupTabPath(basePath: string, tab: GroupTab) {
  if (tab === 'repositories') return basePath
  return `${basePath}/${tab}`
}

import type { Organization } from '../api/types'
import { findGroupByPath } from './groupPath'

export function groupBreadcrumbItems(
  fullPath: string,
  groups?: Organization[],
): { label: string; to?: string }[] {
  const items: { label: string; to?: string }[] = [{ label: 'Groups', to: '/groups' }]
  const segments = fullPath.split('/').filter(Boolean)
  let path = ''
  for (const segment of segments) {
    path = path ? `${path}/${segment}` : segment
    const group = groups ? findGroupByPath(groups, path) : undefined
    items.push({
      label: group?.name ?? segment,
      to: `/groups/${path}`,
    })
  }
  return items
}

export function projectBreadcrumbItems({
  orgPath,
  groups,
  projectName,
  projectTo,
  suffix = [],
}: {
  orgPath: string
  groups?: Organization[]
  projectName: string
  projectTo?: string
  suffix?: { label: string; to?: string }[]
}): { label: string; to?: string }[] {
  return [
    ...groupBreadcrumbItems(orgPath, groups),
    projectTo ? { label: projectName, to: projectTo } : { label: projectName },
    ...suffix,
  ]
}
