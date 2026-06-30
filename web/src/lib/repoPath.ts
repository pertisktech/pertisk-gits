/** Join repository path segments (no leading slash). */
export function joinRepoPath(base: string, segment: string): string {
  const parts = [base, segment]
    .map((part) => part.trim().replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
  return parts.join('/')
}

/** Validate a single file/folder name or relative path segment. */
export function validateRepoPathSegment(
  segment: string,
  options?: { allowDotPrefix?: boolean },
): string | null {
  const trimmed = segment.trim().replace(/^\/+|\/+$/g, '')
  if (!trimmed) return 'Name is required'
  if (trimmed.includes('\\')) return 'Use forward slashes only'
  if (!options?.allowDotPrefix && trimmed.startsWith('.')) {
    return 'Name cannot start with a dot'
  }

  for (const part of trimmed.split('/')) {
    if (!part || part === '.' || part === '..') {
      return 'Invalid path'
    }
  }

  return null
}

/** Path for an empty folder placeholder file. */
export function folderGitkeepPath(folderPath: string): string {
  const trimmed = folderPath.replace(/\/+$/g, '')
  return trimmed ? `${trimmed}/.gitkeep` : '.gitkeep'
}

export function repoPathPreview(base: string, name: string): string {
  return joinRepoPath(base, name)
}
