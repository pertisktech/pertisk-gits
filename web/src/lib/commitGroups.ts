import type { CommitInfo } from '../api/types'

export interface CommitDateGroup {
  key: string
  label: string
  commits: CommitInfo[]
}

function dateKeyFromTimestamp(ts: number): string {
  const d = new Date(ts * 1000)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function todayKey(): string {
  return dateKeyFromTimestamp(Math.floor(Date.now() / 1000))
}

function yesterdayKey(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return dateKeyFromTimestamp(Math.floor(d.getTime() / 1000))
}

export function formatCommitDateGroupLabel(ts: number): string {
  const key = dateKeyFromTimestamp(ts)
  if (key === todayKey()) return 'Today'
  if (key === yesterdayKey()) return 'Yesterday'

  return new Date(ts * 1000).toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export function groupCommitsByDate(commits: CommitInfo[]): CommitDateGroup[] {
  const groups = new Map<string, CommitInfo[]>()

  for (const commit of commits) {
    const key = dateKeyFromTimestamp(commit.committed_at)
    const bucket = groups.get(key)
    if (bucket) bucket.push(commit)
    else groups.set(key, [commit])
  }

  return [...groups.entries()].map(([key, bucket]) => ({
    key,
    label: formatCommitDateGroupLabel(bucket[0]!.committed_at),
    commits: bucket,
  }))
}

export function shouldExpandCommitDateGroup(_key: string, _index: number): boolean {
  return true
}
