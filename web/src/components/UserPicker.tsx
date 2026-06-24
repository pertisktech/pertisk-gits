import { useQuery } from '@tanstack/react-query'
import { Loader2, Search, User, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api/client'
import type { User as UserType } from '../api/types'
import { cn } from '../utils/cn'

interface UserPickerProps {
  token: string
  value: UserType | null
  onChange: (user: UserType | null) => void
  excludeUserIds?: string[]
  placeholder?: string
  disabled?: boolean
  id?: string
  className?: string
}

export function UserPicker({
  token,
  value,
  onChange,
  excludeUserIds = [],
  placeholder = 'Search by username or email…',
  disabled = false,
  id,
  className,
}: UserPickerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 200)
    return () => window.clearTimeout(timer)
  }, [query])

  const { data: results = [], isFetching } = useQuery({
    queryKey: ['user-search', debouncedQuery],
    queryFn: () => api.searchUsers(token, debouncedQuery),
    enabled: Boolean(token && debouncedQuery.trim().length >= 1 && open),
  })

  const excludeSet = useMemo(() => new Set(excludeUserIds), [excludeUserIds])

  const options = useMemo(
    () => results.filter((user) => !excludeSet.has(user.id)),
    [results, excludeSet],
  )

  useEffect(() => {
    setActiveIndex(0)
  }, [options.length, debouncedQuery])

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

  function selectUser(user: UserType) {
    onChange(user)
    setQuery('')
    setDebouncedQuery('')
    setOpen(false)
    inputRef.current?.blur()
  }

  function clearSelection() {
    onChange(null)
    setQuery('')
    setDebouncedQuery('')
    setOpen(false)
    window.requestAnimationFrame(() => inputRef.current?.focus())
  }

  const showDropdown = open && debouncedQuery.trim().length >= 1 && !value

  return (
    <div ref={containerRef} className={cn('relative min-w-[12rem] flex-1', className)}>
      {value ? (
        <div className="app-field flex items-center gap-2 py-1.5 pr-1">
          <User size={14} className="text-muted shrink-0" />
          <span className="min-w-0 flex-1 text-sm">
            <span className="font-medium text-text">@{value.username}</span>
            {(value.display_name ?? value.email) && (
              <span className="text-text-secondary ml-2 truncate">
                {value.display_name ?? value.email}
              </span>
            )}
          </span>
          {!disabled && (
            <button
              type="button"
              className="p-1 rounded hover:bg-hover text-muted hover:text-text"
              onClick={clearSelection}
              aria-label="Clear selected user"
            >
              <X size={14} />
            </button>
          )}
        </div>
      ) : (
        <>
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
          <input
            ref={inputRef}
            id={id}
            type="search"
            value={query}
            disabled={disabled}
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
              if (e.key === 'ArrowDown' && options.length > 0) {
                e.preventDefault()
                setActiveIndex((index) => Math.min(index + 1, options.length - 1))
              }
              if (e.key === 'ArrowUp' && options.length > 0) {
                e.preventDefault()
                setActiveIndex((index) => Math.max(index - 1, 0))
              }
              if (e.key === 'Enter' && options[activeIndex]) {
                e.preventDefault()
                selectUser(options[activeIndex])
              }
            }}
            placeholder={placeholder}
            className="app-field w-full pl-8"
            aria-label="Search users"
            aria-expanded={showDropdown}
            aria-autocomplete="list"
            role="combobox"
            autoComplete="off"
          />
        </>
      )}

      {showDropdown && (
        <div
          className="absolute left-0 right-0 top-full z-50 mt-1 rounded-md border border-naturals-n4 bg-surface shadow-lg overflow-hidden"
          role="listbox"
        >
          {isFetching && options.length === 0 ? (
            <div className="px-3 py-2.5 text-sm text-text-secondary flex items-center gap-2">
              <Loader2 size={14} className="animate-spin" />
              Searching…
            </div>
          ) : options.length === 0 ? (
            <div className="px-3 py-2.5 text-sm text-text-secondary">
              No users found for “{debouncedQuery.trim()}”
            </div>
          ) : (
            <ul className="max-h-60 overflow-y-auto py-1">
              {options.map((user, index) => (
                <li key={user.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={index === activeIndex}
                    className={cn(
                      'w-full px-3 py-2 text-left flex items-start gap-2',
                      index === activeIndex ? 'bg-hover' : 'hover:bg-hover',
                    )}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => selectUser(user)}
                  >
                    <User size={14} className="text-primary shrink-0 mt-0.5" />
                    <span className="min-w-0">
                      <span className="block text-sm text-text truncate">@{user.username}</span>
                      <span className="block text-xs text-muted truncate">
                        {user.display_name ?? user.email}
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
