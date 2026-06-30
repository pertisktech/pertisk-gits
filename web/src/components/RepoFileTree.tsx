import { useQuery } from '@tanstack/react-query'
import { ChevronRight, Loader2 } from 'lucide-react'
import { useMemo } from 'react'
import { api } from '../api/client'
import type { TreeEntry } from '../api/types'
import { isPendingTreePath, mergeTreeEntries } from '../lib/pendingTreeEntries'
import { RepoEntryIcon } from './RepoEntryIcon'
import { cn } from '../utils/cn'

interface RepoFileTreeProps {
  orgSlug: string
  repoSlug: string
  ref: string
  refKind: 'branch' | 'tag'
  token?: string | null
  selectedPath: string | null
  expandedPaths: Set<string>
  pendingPaths?: string[]
  onToggleExpand: (path: string) => void
  onSelectFile: (path: string) => void
}

function parentPaths(filePath: string): string[] {
  const parts = filePath.split('/')
  parts.pop()
  const paths: string[] = []
  for (let i = 0; i < parts.length; i += 1) {
    paths.push(parts.slice(0, i + 1).join('/'))
  }
  return paths
}

export function ancestorPathsForFile(filePath: string): string[] {
  return parentPaths(filePath)
}

function TreeNode({
  entry,
  depth,
  orgSlug,
  repoSlug,
  ref,
  refKind,
  token,
  selectedPath,
  expandedPaths,
  pendingPaths = [],
  onToggleExpand,
  onSelectFile,
}: {
  entry: TreeEntry
  depth: number
  orgSlug: string
  repoSlug: string
  ref: string
  refKind: 'branch' | 'tag'
  token?: string | null
  selectedPath: string | null
  expandedPaths: Set<string>
  pendingPaths: string[]
  onToggleExpand: (path: string) => void
  onSelectFile: (path: string) => void
}) {
  const isDir = entry.kind === 'tree'
  const isExpanded = isDir && expandedPaths.has(entry.path)
  const isSelected = !isDir && selectedPath === entry.path
  const isPending = isPendingTreePath(entry.path, pendingPaths)

  const { data, isLoading } = useQuery({
    queryKey: ['repo-tree', orgSlug, repoSlug, refKind, ref, entry.path, token ?? 'public'],
    queryFn: () =>
      api.getRepoTree(orgSlug, repoSlug, { ref, path: entry.path, ref_kind: refKind }, token),
    enabled: isDir && isExpanded,
  })

  const childEntries = useMemo(() => {
    const merged = mergeTreeEntries(data?.entries ?? [], entry.path, pendingPaths)
    return merged.filter((child) => child.name !== '.gitkeep')
  }, [data?.entries, entry.path, pendingPaths])

  return (
    <>
      <button
        type="button"
        className={cn(
          'repo-explorer-tree-item',
          isSelected && 'repo-explorer-tree-item--active',
          isPending && 'repo-explorer-tree-item--pending',
        )}
        style={{ paddingLeft: `${0.75 + depth * 0.85}rem` }}
        onClick={() => {
          if (isDir) {
            onToggleExpand(entry.path)
            return
          }
          onSelectFile(entry.path)
        }}
      >
        {isDir ? (
          <ChevronRight
            size={14}
            className={cn('repo-explorer-tree-chevron', isExpanded && 'repo-explorer-tree-chevron--open')}
          />
        ) : (
          <span className="repo-explorer-tree-spacer" />
        )}
        {isDir ? (
          <RepoEntryIcon name={entry.name} kind="tree" expanded={isExpanded} size="sm" />
        ) : (
          <RepoEntryIcon name={entry.name} kind="blob" size="sm" />
        )}
        <span className="repo-explorer-tree-name">{entry.name}</span>
      </button>
      {isDir && isExpanded && (
        <>
          {isLoading && childEntries.length === 0 ? (
            <div
              className="repo-explorer-tree-loading"
              style={{ paddingLeft: `${0.75 + (depth + 1) * 0.85}rem` }}
            >
              <Loader2 size={12} className="animate-spin" />
            </div>
          ) : (
            childEntries.map((child) => (
              <TreeNode
                key={child.path}
                entry={child}
                depth={depth + 1}
                orgSlug={orgSlug}
                repoSlug={repoSlug}
                ref={ref}
                refKind={refKind}
                token={token}
                selectedPath={selectedPath}
                expandedPaths={expandedPaths}
                pendingPaths={pendingPaths}
                onToggleExpand={onToggleExpand}
                onSelectFile={onSelectFile}
              />
            ))
          )}
        </>
      )}
    </>
  )
}

export function RepoFileTree({
  orgSlug,
  repoSlug,
  ref,
  refKind,
  token,
  selectedPath,
  expandedPaths,
  pendingPaths = [],
  onToggleExpand,
  onSelectFile,
}: RepoFileTreeProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['repo-tree', orgSlug, repoSlug, refKind, ref, '', token ?? 'public'],
    queryFn: () => api.getRepoTree(orgSlug, repoSlug, { ref, path: '', ref_kind: refKind }, token),
    enabled: Boolean(orgSlug && repoSlug && ref),
  })

  const entries = useMemo(() => {
    const merged = mergeTreeEntries(data?.entries ?? [], '', pendingPaths)
    return merged.filter((entry) => entry.name !== '.gitkeep')
  }, [data?.entries, pendingPaths])

  return (
    <nav className="repo-explorer-tree" aria-label="Repository files">
      {isLoading && entries.length === 0 ? (
        <div className="repo-explorer-tree-loading px-3 py-2">
          <Loader2 size={14} className="animate-spin text-text-secondary" />
        </div>
      ) : entries.length === 0 ? (
        <p className="px-3 py-2 text-xs text-text-secondary">Empty repository</p>
      ) : (
        entries.map((entry) => (
          <TreeNode
            key={entry.path}
            entry={entry}
            depth={0}
            orgSlug={orgSlug}
            repoSlug={repoSlug}
            ref={ref}
            refKind={refKind}
            token={token}
            selectedPath={selectedPath}
            expandedPaths={expandedPaths}
            pendingPaths={pendingPaths}
            onToggleExpand={onToggleExpand}
            onSelectFile={onSelectFile}
          />
        ))
      )}
    </nav>
  )
}
