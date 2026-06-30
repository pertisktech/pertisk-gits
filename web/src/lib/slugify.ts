export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/** Slugify each path segment for nested group paths (e.g. GitLab `mp/coupon`). */
export function slugifyPath(path: string): string {
  return path
    .split('/')
    .map((segment) => slugify(segment))
    .filter(Boolean)
    .join('/')
}

export function remoteNamespaceLabel(provider: 'github' | 'gitlab'): string {
  return provider === 'github' ? 'GitHub organization' : 'GitLab group'
}
