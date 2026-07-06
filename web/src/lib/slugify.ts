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

export function remoteNamespaceLabel(provider: 'github' | 'gitlab' | 'pertisk'): string {
  if (provider === 'github') return 'GitHub organization'
  if (provider === 'pertisk') return 'Pertisk group'
  return 'GitLab group'
}

export function importProviderLabel(provider: 'github' | 'gitlab' | 'pertisk'): string {
  if (provider === 'github') return 'GitHub'
  if (provider === 'pertisk') return 'Pertisk Gits'
  return 'GitLab'
}
