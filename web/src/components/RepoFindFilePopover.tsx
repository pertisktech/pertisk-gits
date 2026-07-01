import { useQuery } from '@tanstack/react-query'
import { FileCode2, Loader2, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api/client'
import { ToolbarIconButton, ToolbarPopover } from './ui'

interface RepoFindFilePopoverProps {
  token?: string | null
  orgSlug: string
  repoSlug: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelectPath: (path: string) => void
}

export function RepoFindFilePopover({
  token,
  orgSlug,
  repoSlug,
  open,
  onOpenChange,
  onSelectPath,
}: RepoFindFilePopoverProps) {
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const trimmed = query.trim()

  const { data: status } = useQuery({
    queryKey: ['repo-search-status', orgSlug, repoSlug, token ?? 'public'],
    queryFn: () => api.getRepoSearchStatus(orgSlug, repoSlug, token),
    enabled: Boolean(orgSlug && repoSlug && open),
  })

  const { data, isFetching } = useQuery({
    queryKey: ['repo-code-search', orgSlug, repoSlug, trimmed, token ?? 'public'],
    queryFn: () => api.searchRepoCode(orgSlug, repoSlug, trimmed, token),
    enabled: Boolean(orgSlug && repoSlug && open && trimmed.length >= 2),
  })

  const hits = useMemo(() => data?.hits ?? [], [data?.hits])

  useEffect(() => {
    function onClickOutside(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        onOpenChange(false)
      }
    }
    if (open) {
      document.addEventListener('mousedown', onClickOutside)
      return () => document.removeEventListener('mousedown', onClickOutside)
    }
  }, [onOpenChange, open])

  useEffect(() => {
    if (!open) {
      setQuery('')
      return
    }
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => window.clearTimeout(timer)
  }, [open])

  function selectPath(path: string) {
    onSelectPath(path)
    onOpenChange(false)
    setQuery('')
  }

  return (
    <ToolbarPopover ref={rootRef}>
      <ToolbarIconButton
        aria-expanded={open}
        title="Find file (t)"
        aria-label="Find file"
        onClick={() => onOpenChange(!open)}
      >
        <Search size={14} />
      </ToolbarIconButton>

      {open && (
        <div className="app-find-file-panel" role="dialog" aria-label="Find file">
          <div className="app-find-file-search">
            <Search size={14} className="text-muted shrink-0" />
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search in this repository…"
              className="app-find-file-input"
            />
            {isFetching && <Loader2 size={14} className="animate-spin text-muted shrink-0" />}
          </div>

          {status && (
            <p className="app-find-file-meta">
              {status.indexed
                ? `${status.document_count ?? 0} indexed files`
                : 'Index builds after the next push'}
            </p>
          )}

          {trimmed.length >= 2 && !isFetching && hits.length === 0 && (
            <p className="app-find-file-empty">No matches for “{trimmed}”.</p>
          )}

          {hits.length > 0 && (
            <ul className="app-find-file-results">
              {hits.map((hit) => (
                <li key={`${hit.path}-${hit.commit_sha}`}>
                  <button type="button" className="app-find-file-hit" onClick={() => selectPath(hit.path)}>
                    <span className="app-find-file-hit-path">
                      <FileCode2 size={14} className="shrink-0" />
                      {hit.path}
                    </span>
                    <span className="app-find-file-hit-snippet">{hit.snippet}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {trimmed.length < 2 && (
            <p className="app-find-file-hint">Type at least 2 characters to search code.</p>
          )}
        </div>
      )}
    </ToolbarPopover>
  )
}
