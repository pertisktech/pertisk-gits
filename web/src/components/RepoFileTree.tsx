import { useQuery } from '@tanstack/react-query'
import { ChevronRight, File, Folder, Loader2 } from 'lucide-react'
import { useMemo } from 'react'
import { api } from '../api/client'
import type { TreeEntry } from '../api/types'
import { cn } from '../utils/cn'

interface RepoFileTreeProps {
  orgSlug: string
  repoSlug: string
  ref: string
  refKind: 'branch' | 'tag'
  token?: string | null
  selectedPath: string | null
  expandedPaths: Set<string>
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
  onToggleExpand: (path: string) => void
  onSelectFile: (path: string) => void
}) {
  const isDir = entry.kind === 'tree'
  const isExpanded = isDir && expandedPaths.has(entry.path)
  const isSelected = !isDir && selectedPath === entry.path

  const { data, isLoading } = useQuery({
    queryKey: ['repo-tree', orgSlug, repoSlug, refKind, ref, entry.path, token ?? 'public'],
    queryFn: () =>
      api.getRepoTree(orgSlug, repoSlug, { ref, path: entry.path, ref_kind: refKind }, token),
    enabled: isDir && isExpanded,
  })

  return (
    <>
      <button
        type="button"
        className={cn('repo-explorer-tree-item', isSelected && 'repo-explorer-tree-item--active')}
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
          <Folder size={14} className="repo-explorer-tree-icon" />
        ) : (
          <File size={14} className="repo-explorer-tree-icon" />
        )}
        <span className="repo-explorer-tree-name">{entry.name}</span>
      </button>
      {isDir && isExpanded && (
        <>
          {isLoading ? (
            <div
              className="repo-explorer-tree-loading"
              style={{ paddingLeft: `${0.75 + (depth + 1) * 0.85}rem` }}
            >
              <Loader2 size={12} className="animate-spin" />
            </div>
          ) : (
            (data?.entries ?? []).map((child) => (
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
  onToggleExpand,
  onSelectFile,
}: RepoFileTreeProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['repo-tree', orgSlug, repoSlug, refKind, ref, '', token ?? 'public'],
    queryFn: () => api.getRepoTree(orgSlug, repoSlug, { ref, path: '', ref_kind: refKind }, token),
    enabled: Boolean(orgSlug && repoSlug && ref),
  })

  const entries = useMemo(() => data?.entries ?? [], [data?.entries])

  return (
    <nav className="repo-explorer-tree" aria-label="Repository files">
      {isLoading ? (
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
            onToggleExpand={onToggleExpand}
            onSelectFile={onSelectFile}
          />
        ))
      )}
    </nav>
  )
}
