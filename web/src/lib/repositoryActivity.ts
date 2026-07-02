import type { Repository } from '../api/types'

/** ISO timestamp for repo list “last activity” — prefer latest commit on default branch. */
export function repositoryActivityAt(repo: Pick<Repository, 'last_commit_at' | 'updated_at'>): string {
  return repo.last_commit_at ?? repo.updated_at
}

export function repositoryActivityMs(repo: Pick<Repository, 'last_commit_at' | 'updated_at'>): number {
  const iso = repositoryActivityAt(repo)
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? ms : 0
}
