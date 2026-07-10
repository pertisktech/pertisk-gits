import { ChevronDown, GitBranch, Search, Tag } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../utils/cn'

const REF_SEARCH_THRESHOLD = 8

export function encodeRef(kind: 'branch' | 'tag', name: string) {
  return `${kind}/${name}`
}

export function decodeRef(value: string): { kind: 'branch' | 'tag'; name: string } {
  const slash = value.indexOf('/')
  if (slash <= 0) return { kind: 'branch', name: value }
  const kind = value.slice(0, slash)
  return { kind: kind === 'tag' ? 'tag' : 'branch', name: value.slice(slash + 1) }
}

type RefOption = { kind: 'branch' | 'tag'; name: string }

function filterRefs(items: string[], query: string) {
  const q = query.trim().toLowerCase()
  if (!q) return items
  return items.filter((name) => name.toLowerCase().includes(q))
}

export function RefSelect({
  refKind,
  refName,
  branches,
  tags,
  fallbackRef,
  onChange,
  alwaysMenu,
  placeholder,
  disabled,
  className,
  id,
  'aria-label': ariaLabel,
}: {
  refKind: 'branch' | 'tag'
  refName: string
  branches: string[]
  tags: string[]
  fallbackRef: string
  onChange: (kind: 'branch' | 'tag', name: string) => void
  alwaysMenu?: boolean
  placeholder?: string
  disabled?: boolean
  className?: string
  id?: string
  'aria-label'?: string
}) {
  const branchList = branches.length > 0 ? branches : [fallbackRef]
  const searchable = Boolean(alwaysMenu) || branchList.length + tags.length > REF_SEARCH_THRESHOLD

  const wrapRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({})

  const filteredBranches = useMemo(() => filterRefs(branchList, query), [branchList, query])
  const filteredTags = useMemo(() => filterRefs(tags, query), [tags, query])

  const options = useMemo(() => {
    const list: RefOption[] = []
    for (const name of filteredBranches) list.push({ kind: 'branch', name })
    for (const name of filteredTags) list.push({ kind: 'tag', name })
    return list
  }, [filteredBranches, filteredTags])

  const hasSelected =
    (refKind === 'branch' && branchList.includes(refName)) ||
    (refKind === 'tag' && tags.includes(refName))
  const triggerLabel = hasSelected ? refName : (placeholder ?? refName)
  const nativeValue = hasSelected
    ? encodeRef(refKind, refName)
    : refKind === 'tag' && tags.length > 0
      ? encodeRef('tag', tags[0])
      : encodeRef('branch', branchList.includes(refName) ? refName : branchList[0])

  const updateMenuPosition = () => {
    const trigger = triggerRef.current
    if (!trigger) return

    const rect = trigger.getBoundingClientRect()
    const menuWidth = Math.max(rect.width, 224)
    const menuHeight = menuRef.current?.offsetHeight ?? 280
    const gap = 6
    const pad = 8
    const desiredMaxHeight = Math.min(420, window.innerHeight - pad * 2)

    let left = rect.left
    left = Math.max(pad, Math.min(left, window.innerWidth - menuWidth - pad))

    const spaceBelow = window.innerHeight - rect.bottom - gap - pad
    const spaceAbove = rect.top - gap - pad
    const availableBelow = Math.max(120, Math.min(desiredMaxHeight, spaceBelow))
    const availableAbove = Math.max(120, Math.min(desiredMaxHeight, spaceAbove))
    const effectiveMenuHeight = Math.min(menuHeight, desiredMaxHeight)
    const fitsBelow = effectiveMenuHeight <= spaceBelow
    const fitsAbove = effectiveMenuHeight <= spaceAbove

    let top: number
    let maxHeight: number

    if (fitsBelow || (!fitsAbove && spaceBelow >= spaceAbove)) {
      top = rect.bottom + gap
      maxHeight = availableBelow
    } else {
      maxHeight = availableAbove
      top = rect.top - maxHeight - gap
      top = Math.max(pad, top)
    }

    setMenuStyle({
      top,
      left,
      width: menuWidth,
      minWidth: rect.width,
      maxWidth: Math.min(352, window.innerWidth - pad * 2),
      maxHeight,
    })
  }

  useEffect(() => {
    if (!searchable) {
      setOpen(false)
      setQuery('')
    }
  }, [searchable])

  useLayoutEffect(() => {
    if (!searchable || !open) return
    updateMenuPosition()
    const raf = requestAnimationFrame(updateMenuPosition)
    window.addEventListener('resize', updateMenuPosition)
    window.addEventListener('scroll', updateMenuPosition, true)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', updateMenuPosition)
      window.removeEventListener('scroll', updateMenuPosition, true)
    }
  }, [open, options.length, query, searchable])

  useEffect(() => {
    setActiveIndex(0)
  }, [query, options.length])

  useEffect(() => {
    if (!searchable || !open) return
    function onDocumentClick(event: MouseEvent) {
      const target = event.target as Node
      if (wrapRef.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      setOpen(false)
      setQuery('')
    }
    document.addEventListener('mousedown', onDocumentClick)
    return () => document.removeEventListener('mousedown', onDocumentClick)
  }, [open, searchable])

  useEffect(() => {
    if (!searchable) return
    if (open) {
      window.requestAnimationFrame(() => searchRef.current?.focus())
    } else {
      setQuery('')
    }
  }, [open, searchable])

  useEffect(() => {
    if (!open) return
    const active = menuRef.current?.querySelector<HTMLButtonElement>('.app-ref-select-option--active')
    active?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, open])

  function selectOption(option: RefOption) {
    onChange(option.kind, option.name)
    setOpen(false)
    setQuery('')
  }

  function toggleOpen() {
    if (disabled) return
    setOpen((value) => !value)
  }

  if (!searchable) {
    return (
      <select
        id={id}
        className={cn('app-field app-select app-branch-select app-ref-select', className)}
        value={nativeValue}
        disabled={disabled}
        aria-label={ariaLabel ?? 'Repository reference'}
        onChange={(e) => {
          const next = decodeRef(e.target.value)
          onChange(next.kind, next.name)
        }}
      >
        <optgroup label="Branches">
          {branchList.map((branch) => (
            <option key={encodeRef('branch', branch)} value={encodeRef('branch', branch)}>
              {branch}
            </option>
          ))}
        </optgroup>
        {tags.length > 0 && (
          <optgroup label="Tags">
            {tags.map((tag) => (
              <option key={encodeRef('tag', tag)} value={encodeRef('tag', tag)}>
                {tag}
              </option>
            ))}
          </optgroup>
        )}
      </select>
    )
  }

  const KindIcon = refKind === 'tag' ? Tag : GitBranch

  const menu = open
    ? createPortal(
        <div
          ref={menuRef}
          className="app-ref-select-menu app-ref-select-menu--portal"
          style={menuStyle}
          role="presentation"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="app-ref-select-search">
            <Search size={14} className="text-muted shrink-0" aria-hidden />
            <input
              ref={searchRef}
              type="search"
              value={query}
              placeholder="Filter branches and tags…"
              className="app-ref-select-search-input"
              aria-label="Filter branches and tags"
              autoComplete="off"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setOpen(false)
                  setQuery('')
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
                  selectOption(options[activeIndex])
                }
              }}
            />
          </div>

          <div className="app-ref-select-list" role="listbox" aria-label="Branches and tags">
            {options.length === 0 ? (
              <div className="app-ref-select-empty">
                {query.trim() ? `No matches for “${query.trim()}”` : 'No branches or tags'}
              </div>
            ) : (
              <>
                {filteredBranches.length > 0 && (
                  <RefSelectGroup
                    label="Branches"
                    options={filteredBranches.map((name) => ({ kind: 'branch' as const, name }))}
                    selectedKind={refKind}
                    selectedName={refName}
                    activeIndex={activeIndex}
                    indexOffset={0}
                    onHover={setActiveIndex}
                    onSelect={selectOption}
                  />
                )}
                {filteredTags.length > 0 && (
                  <RefSelectGroup
                    label="Tags"
                    options={filteredTags.map((name) => ({ kind: 'tag' as const, name }))}
                    selectedKind={refKind}
                    selectedName={refName}
                    activeIndex={activeIndex}
                    indexOffset={filteredBranches.length}
                    onHover={setActiveIndex}
                    onSelect={selectOption}
                  />
                )}
              </>
            )}
          </div>
        </div>,
        document.body,
      )
    : null

  return (
    <div ref={wrapRef} className={cn('app-ref-select-wrap', className)}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className="app-ref-select-trigger"
        disabled={disabled}
        aria-label={ariaLabel ?? 'Repository reference'}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={toggleOpen}
      >
        <KindIcon size={14} className="shrink-0 text-primary" aria-hidden />
        <span className="app-ref-select-trigger-label">{triggerLabel}</span>
        <ChevronDown size={14} className="shrink-0 text-muted" aria-hidden />
      </button>
      {menu}
    </div>
  )
}

function RefSelectGroup({
  label,
  options,
  selectedKind,
  selectedName,
  activeIndex,
  indexOffset,
  onHover,
  onSelect,
}: {
  label: string
  options: RefOption[]
  selectedKind: 'branch' | 'tag'
  selectedName: string
  activeIndex: number
  indexOffset: number
  onHover: (index: number) => void
  onSelect: (option: RefOption) => void
}) {
  const Icon = label === 'Tags' ? Tag : GitBranch

  return (
    <div className="app-ref-select-group">
      <div className="app-ref-select-group-label">{label}</div>
      <ul className="app-ref-select-options">
        {options.map((option, localIndex) => {
          const globalIndex = indexOffset + localIndex
          const selected = option.kind === selectedKind && option.name === selectedName
          return (
            <li key={encodeRef(option.kind, option.name)}>
              <button
                type="button"
                role="option"
                aria-selected={selected}
                className={cn(
                  'app-ref-select-option',
                  selected && 'app-ref-select-option--selected',
                  globalIndex === activeIndex && 'app-ref-select-option--active',
                )}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => onHover(globalIndex)}
                onClick={() => onSelect(option)}
              >
                <Icon size={13} className="shrink-0 text-muted" aria-hidden />
                <span className="truncate">{option.name}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
