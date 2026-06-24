/** GitHub-style relative timestamps for file rows and commit lists. */
export function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts * 1000
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`

  const days = Math.floor(hours / 24)
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  if (days < 14) return 'last week'

  const weeks = Math.floor(days / 7)
  if (weeks < 5) return `${weeks} weeks ago`
  if (days < 60) return 'last month'

  const months = Math.floor(days / 30)
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`
  if (days < 730) return 'last year'

  const years = Math.floor(days / 365)
  return `${years} year${years === 1 ? '' : 's'} ago`
}

export function parseIsoTimestamp(iso: string): number {
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? 0 : ms
}

export function formatRelativeTimeFromIso(iso: string): string {
  const ms = parseIsoTimestamp(iso)
  if (ms === 0) return '—'
  return formatRelativeTime(Math.floor(ms / 1000))
}
