import type { TreeEntry } from '../api/types'

function sortTreeEntries(entries: TreeEntry[]): TreeEntry[] {
  return [...entries].sort((a, b) => {
    const aDir = a.kind === 'tree' ? 1 : 0
    const bDir = b.kind === 'tree' ? 1 : 0
    return bDir - aDir || a.name.toLowerCase().localeCompare(b.name.toLowerCase())
  })
}

/** Virtual tree entries implied by unsaved / new file paths at `parentPath`. */
export function pendingEntriesAt(parentPath: string, pendingPaths: string[]): TreeEntry[] {
  const normalizedParent = parentPath.replace(/^\/+|\/+$/g, '')
  const prefix = normalizedParent ? `${normalizedParent}/` : ''
  const seenSegments = new Set<string>()
  const entries: TreeEntry[] = []

  for (const fullPath of pendingPaths) {
    if (!fullPath) continue
    if (normalizedParent && !fullPath.startsWith(prefix)) continue

    const relative = normalizedParent ? fullPath.slice(prefix.length) : fullPath
    if (!relative) continue

    const slashIdx = relative.indexOf('/')
    const segment = slashIdx >= 0 ? relative.slice(0, slashIdx) : relative
    if (!segment || seenSegments.has(segment)) continue
    seenSegments.add(segment)

    const childPath = normalizedParent ? `${normalizedParent}/${segment}` : segment
    const hasMore = slashIdx >= 0

    entries.push({
      name: segment,
      path: childPath,
      kind: hasMore ? 'tree' : 'blob',
      mode: hasMore ? '040000' : '100644',
      size: null,
    })
  }

  return entries
}

export function mergeTreeEntries(
  apiEntries: TreeEntry[],
  parentPath: string,
  pendingPaths: string[],
): TreeEntry[] {
  if (pendingPaths.length === 0) return apiEntries

  const byPath = new Map(apiEntries.map((entry) => [entry.path, entry]))
  for (const entry of pendingEntriesAt(parentPath, pendingPaths)) {
    if (!byPath.has(entry.path)) {
      byPath.set(entry.path, entry)
    }
  }

  return sortTreeEntries(Array.from(byPath.values()))
}

export function isPendingTreePath(path: string, pendingPaths: string[]): boolean {
  return pendingPaths.some(
    (pending) => pending === path || pending.startsWith(`${path}/`),
  )
}
