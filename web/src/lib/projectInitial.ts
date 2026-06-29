/** First letter for repo avatar on dashboard (e.g. webview-door → W). */
export function projectInitial(name: string, slug: string): string {
  const source = (name.trim() || slug.trim()).replace(/^[-_./]+/, '')
  const match = source.match(/[a-zA-Z0-9]/)
  return match ? match[0].toUpperCase() : '?'
}

/** Short repo title for headers when name includes a group path prefix. */
export function displayRepoName(name: string, slug: string): string {
  const trimmed = name.trim()
  if (trimmed.includes('/')) return slug
  return trimmed || slug
}
