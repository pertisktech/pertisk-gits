import { useQuery } from '@tanstack/react-query'
import { FileCode2, Loader2, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'

export function RepoCodeSearch({
  token,
  orgSlug,
  repoSlug,
}: {
  token?: string | null
  orgSlug: string
  repoSlug: string
}) {
  const [query, setQuery] = useState('')
  const trimmed = query.trim()

  const { data: status } = useQuery({
    queryKey: ['repo-search-status', orgSlug, repoSlug, token ?? 'public'],
    queryFn: () => api.getRepoSearchStatus(orgSlug, repoSlug, token),
    enabled: Boolean(orgSlug && repoSlug),
  })

  const { data, isFetching } = useQuery({
    queryKey: ['repo-code-search', orgSlug, repoSlug, trimmed, token ?? 'public'],
    queryFn: () => api.searchRepoCode(orgSlug, repoSlug, trimmed, token),
    enabled: Boolean(orgSlug && repoSlug && trimmed.length >= 2),
  })

  const hits = useMemo(() => data?.hits ?? [], [data?.hits])

  return (
    <div className="app-panel app-panel-body space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-text">Search code</h3>
          <p className="text-xs text-text-secondary mt-0.5">
            {status?.indexed
              ? `Indexed ${status.document_count ?? 0} files from ${status.ref_name?.replace('refs/heads/', '') ?? 'default branch'}`
              : 'Index builds after the next push to a branch'}
          </p>
        </div>
      </div>

      <div className="relative max-w-xl">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search in this repository…"
          className="w-full pl-8 pr-3 py-2 rounded-lg border border-naturals-n4 bg-surface text-sm text-text placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
        />
      </div>

      {trimmed.length >= 2 ? (
        isFetching ? (
          <div className="flex items-center gap-2 text-sm text-text-secondary py-2">
            <Loader2 size={14} className="animate-spin" />
            Searching…
          </div>
        ) : hits.length === 0 ? (
          <p className="text-sm text-text-secondary">No code matches for “{trimmed}”.</p>
        ) : (
          <ul className="divide-y divide-naturals-n4 border border-naturals-n4 rounded-lg overflow-hidden">
            {hits.map((hit) => (
              <li key={`${hit.path}-${hit.commit_sha}`}>
                <Link
                  to={`/groups/${orgSlug}/projects/${repoSlug}?file=${encodeURIComponent(hit.path)}`}
                  className="block px-3 py-2.5 hover:bg-hover"
                >
                  <div className="flex items-center gap-2 text-sm text-primary font-mono truncate">
                    <FileCode2 size={14} className="shrink-0" />
                    {hit.path}
                  </div>
                  <p className="text-xs text-text-secondary mt-1 font-mono line-clamp-2">{hit.snippet}</p>
                </Link>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  )
}
