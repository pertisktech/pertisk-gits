import { useQueries, useQuery } from '@tanstack/react-query'
import { FolderGit2, Search, Users, FileCode2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { groupUrlPath } from '../lib/groupPath'

type SearchResult =
  | { type: 'group'; orgPath: string; name: string; description?: string | null }
  | { type: 'repo'; orgSlug: string; slug: string; name: string; fullPath: string }
  | {
      type: 'code'
      orgSlug: string
      repoSlug: string
      path: string
      snippet: string
      fullPath: string
    }

  function resultKey(result: SearchResult) {
    if (result.type === 'group') return `g-${result.orgPath}`
    if (result.type === 'repo') return `r-${result.fullPath}`
    return `c-${result.fullPath}`
  }

  function resultIcon(result: SearchResult) {
    if (result.type === 'group') return <Users size={14} className="text-primary shrink-0 mt-0.5" />
    if (result.type === 'repo') return <FolderGit2 size={14} className="text-primary shrink-0 mt-0.5" />
    return <FileCode2 size={14} className="text-primary shrink-0 mt-0.5" />
  }

function resultUrl(result: SearchResult) {
  if (result.type === 'group') return `/groups/${result.orgPath}`
  if (result.type === 'repo') return `/groups/${result.orgSlug}/projects/${result.slug}`
  return `/groups/${result.orgSlug}/projects/${result.repoSlug}?file=${encodeURIComponent(result.path)}`
}

export function GlobalSearch() {
  const { token } = useAuth()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const { data: groups = [] } = useQuery({
    queryKey: ['organizations'],
    queryFn: () => api.listOrganizations(token!),
    enabled: Boolean(token),
  })

  const repoQueries = useQueries({
    queries: groups.map((group) => {
      const orgPath = groupUrlPath(group)
      return {
        queryKey: ['repositories', orgPath],
        queryFn: () => api.listRepositories(token!, orgPath),
        enabled: Boolean(token),
      }
    }),
  })

  const trimmedQuery = query.trim()
  const codeEnabled = trimmedQuery.length >= 2

  const { data: codeResults } = useQuery({
    queryKey: ['global-code-search', trimmedQuery],
    queryFn: () => api.searchCode(trimmedQuery, token),
    enabled: Boolean(token && codeEnabled),
  })

  const results = useMemo(() => {
    const q = trimmedQuery.toLowerCase()
    if (!q) return []

    const items: SearchResult[] = []

    for (const group of groups) {
      const orgPath = groupUrlPath(group)
      const haystack = `${group.name} ${orgPath} ${group.slug}`.toLowerCase()
      if (haystack.includes(q)) {
        items.push({
          type: 'group',
          orgPath,
          name: group.name,
          description: group.description,
        })
      }
    }

    groups.forEach((group, index) => {
      const orgPath = groupUrlPath(group)
      const repos = repoQueries[index]?.data ?? []
      for (const repo of repos) {
        const fullPath = `${orgPath}/${repo.slug}`
        if (
          repo.name.toLowerCase().includes(q) ||
          repo.slug.toLowerCase().includes(q) ||
          fullPath.toLowerCase().includes(q)
        ) {
          items.push({
            type: 'repo',
            orgSlug: orgPath,
            slug: repo.slug,
            name: repo.name,
            fullPath,
          })
        }
      }
    })

    return items.slice(0, 12)
  }, [trimmedQuery, groups, repoQueries])

  const codeHits = useMemo(() => {
    const hits = codeResults?.hits ?? []
    return hits.slice(0, 8).map((hit) => ({
      type: 'code' as const,
      orgSlug: hit.org_slug,
      repoSlug: hit.repo_slug,
      path: hit.path,
      snippet: hit.snippet,
      fullPath: `${hit.org_slug}/${hit.repo_slug}/${hit.path}`,
    }))
  }, [codeResults?.hits])

  const combinedResults = useMemo(
    () => [...results, ...codeHits].slice(0, 16),
    [results, codeHits],
  )

  useEffect(() => {
    if (!open) return
    function onDocumentClick(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocumentClick)
    return () => document.removeEventListener('mousedown', onDocumentClick)
  }, [open])

  function goTo(result: SearchResult) {
    navigate(resultUrl(result))
    setQuery('')
    setOpen(false)
    inputRef.current?.blur()
  }

  if (!token) return null

  const showDropdown = open && trimmedQuery.length > 0

  return (
    <div ref={containerRef} className="relative flex-1 min-w-0 max-w-xl">
      <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
      <input
        ref={inputRef}
        type="search"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setOpen(false)
            inputRef.current?.blur()
          }
          if (e.key === 'Enter' && combinedResults[0]) {
            e.preventDefault()
            goTo(combinedResults[0])
          }
        }}
        placeholder="Search groups, repositories, and code…"
        className="w-full pl-8 pr-3 py-1.5 rounded-md border border-naturals-n4 bg-bg text-sm text-text placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-primary/40"
        aria-label="Search groups and repositories"
        aria-autocomplete="list"
      />

      {showDropdown && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-md border border-naturals-n4 bg-surface shadow-lg overflow-hidden">
          {combinedResults.length === 0 ? (
            <div className="px-3 py-2.5 text-sm text-text-secondary">No results for “{trimmedQuery}”</div>
          ) : (
            <ul className="max-h-72 overflow-y-auto py-1">
              {combinedResults.map((result) => (
                <li key={resultKey(result)}>
                  <button
                    type="button"
                    className="w-full px-3 py-2 text-left hover:bg-hover flex items-start gap-2"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => goTo(result)}
                  >
                    {resultIcon(result)}
                    <span className="min-w-0">
                      <span className="block text-sm text-text truncate">
                        {result.type === 'code' ? result.path : result.name}
                      </span>
                      {result.type !== 'repo' && (
                        <span className="block text-xs text-muted font-mono truncate">
                          {result.type === 'code'
                            ? result.fullPath
                            : result.orgPath}
                        </span>
                      )}
                      {result.type === 'code' ? (
                        <span className="block text-xs text-text-secondary font-mono truncate mt-0.5">
                          {result.snippet}
                        </span>
                      ) : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
