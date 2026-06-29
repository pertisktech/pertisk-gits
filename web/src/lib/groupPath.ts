import type { Organization } from '../api/types'

/** URL path segment for a group (`a/b/c`). */
export function groupUrlPath(group: Pick<Organization, 'full_path' | 'slug'>): string {
  return group.full_path || group.slug
}

export function groupBaseUrl(group: Pick<Organization, 'full_path' | 'slug'>): string {
  return `/groups/${groupUrlPath(group)}`
}

export function findGroupByPath(groups: Organization[], path: string): Organization | undefined {
  const normalized = path.replace(/^\/+|\/+$/g, '')
  return groups.find((g) => (g.full_path || g.slug) === normalized)
}
