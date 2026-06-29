/** First letter for repo avatar on dashboard (e.g. webview-door → W). */
export function projectInitial(name: string, slug: string): string {
  const source = (name.trim() || slug.trim()).replace(/^[-_./]+/, '')
  const match = source.match(/[a-zA-Z0-9]/)
  return match ? match[0].toUpperCase() : '?'
}
