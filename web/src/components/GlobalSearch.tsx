import { useQueries, useQuery } from '@tanstack/react-query'
import { FolderGit2, Search, Users } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'

type SearchResult =
  | { type: 'group'; slug: string; name: string; description?: string | null }
  | { type: 'repo'; orgSlug: string; slug: string; name: string; fullPath: string }

function resultUrl(result: SearchResult) {
  return result.type === 'group'
    ? `/groups/${result.slug}`
    : `/groups/${result.orgSlug}/projects/${result.slug}`
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
    queries: groups.map((group) => ({
      queryKey: ['repositories', group.slug],
      queryFn: () => api.listRepositories(token!, group.slug),
      enabled: Boolean(token),
    })),
  })

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []

    const items: SearchResult[] = []

    for (const group of groups) {
      if (group.name.toLowerCase().includes(q) || group.slug.toLowerCase().includes(q)) {
        items.push({
          type: 'group',
          slug: group.slug,
          name: group.name,
          description: group.description,
        })
      }
    }

    groups.forEach((group, index) => {
      const repos = repoQueries[index]?.data ?? []
      for (const repo of repos) {
        const fullPath = `${group.slug}/${repo.slug}`
        if (
          repo.name.toLowerCase().includes(q) ||
          repo.slug.toLowerCase().includes(q) ||
          fullPath.toLowerCase().includes(q)
        ) {
          items.push({
            type: 'repo',
            orgSlug: group.slug,
            slug: repo.slug,
            name: repo.name,
            fullPath,
          })
        }
      }
    })

    return items.slice(0, 12)
  }, [query, groups, repoQueries])

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

  const showDropdown = open && query.trim().length > 0

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
          if (e.key === 'Enter' && results[0]) {
            e.preventDefault()
            goTo(results[0])
          }
        }}
        placeholder="Search groups and repositories…"
        className="w-full pl-8 pr-3 py-1.5 rounded-md border border-naturals-n4 bg-bg text-sm text-text placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-primary/40"
        aria-label="Search groups and repositories"
        aria-expanded={showDropdown}
        aria-autocomplete="list"
        role="combobox"
      />

      {showDropdown && (
        <div
          className="absolute left-0 right-0 top-full z-50 mt-1 rounded-md border border-naturals-n4 bg-surface shadow-lg overflow-hidden"
          role="listbox"
        >
          {results.length === 0 ? (
            <div className="px-3 py-2.5 text-sm text-text-secondary">No results for “{query.trim()}”</div>
          ) : (
            <ul className="max-h-72 overflow-y-auto py-1">
              {results.map((result) => (
                <li key={result.type === 'group' ? `g-${result.slug}` : `r-${result.fullPath}`}>
                  <button
                    type="button"
                    role="option"
                    className="w-full px-3 py-2 text-left hover:bg-hover flex items-start gap-2"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => goTo(result)}
                  >
                    {result.type === 'group' ? (
                      <Users size={14} className="text-primary shrink-0 mt-0.5" />
                    ) : (
                      <FolderGit2 size={14} className="text-primary shrink-0 mt-0.5" />
                    )}
                    <span className="min-w-0">
                      <span className="block text-sm text-text truncate">{result.name}</span>
                      <span className="block text-xs text-muted font-mono truncate">
                        {result.type === 'group' ? result.slug : result.fullPath}
                      </span>
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
