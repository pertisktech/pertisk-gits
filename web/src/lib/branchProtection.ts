/** Returns true when `branch` matches a protection `pattern` (`*` wildcard). */
export function branchMatchesPattern(branch: string, pattern: string): boolean {
  const b = branch.trim()
  const p = pattern.trim()
  if (!p || !b) return false
  if (p === '*') return true
  if (!p.includes('*')) return b === p

  const parts = p.split('*')
  if (parts.length === 0) return true

  let rest = b
  if (!p.startsWith('*')) {
    const prefix = parts[0]
    if (!rest.startsWith(prefix)) return false
    rest = rest.slice(prefix.length)
  }

  for (const part of parts.slice(1)) {
    if (!part) continue
    const index = rest.indexOf(part)
    if (index === -1) return false
    rest = rest.slice(index + part.length)
  }

  return p.endsWith('*') ? true : rest.length === 0
}
