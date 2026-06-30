import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  ChevronRight,
  FilePlus,
  Folder,
  Loader2,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import type { TreeEntry } from '../api/types'
import { findReadmePath } from '../lib/readme'
import { formatRelativeTime } from '../lib/relativeTime'
import { commitUrl } from './RepoCommits'
import { ancestorPathsForFile, RepoFileTree } from './RepoFileTree'
import { NewFileBar, RepoFileEditor, type OpenFileState } from './RepoFileEditor'
import { RepoClonePushGuide } from './RepoClonePushGuide'
import { RepoEntryIcon } from './RepoEntryIcon'
import { RepoReadme } from './RepoReadme'
import { SecondaryButton, RefSelect } from './ui'

interface RepoBrowserProps {
  token?: string | null
  orgSlug: string
  repoSlug: string
  defaultBranch: string
  cloneUrl?: string
  authCloneUrl?: string
  cloneUrlSsh?: string | null
  isPrivate?: boolean
}

export function RepoBrowser({
  token,
  orgSlug,
  repoSlug,
  defaultBranch,
  cloneUrl,
  authCloneUrl,
  cloneUrlSsh,
  isPrivate = false,
}: RepoBrowserProps) {
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const initialFile = searchParams.get('file')

  const [path, setPath] = useState(() => {
    if (!initialFile) return ''
    const slash = initialFile.lastIndexOf('/')
    return slash >= 0 ? initialFile.slice(0, slash) : ''
  })
  const [refOverride, setRefOverride] = useState<string | null>(null)
  const [refKind, setRefKind] = useState<'branch' | 'tag'>('branch')
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set())
  const [openFiles, setOpenFiles] = useState<OpenFileState[]>([])
  const [activePath, setActivePath] = useState<string | null>(initialFile)
  const [loadingPath, setLoadingPath] = useState<string | null>(null)
  const [showNewFile, setShowNewFile] = useState(false)
  const openFilesRef = useRef(openFiles)
  openFilesRef.current = openFiles

  const inEditMode = activePath !== null

  const { data: browserData, isLoading: browserLoading } = useQuery({
    queryKey: ['repo-browser', orgSlug, repoSlug],
    queryFn: () => api.getRepoBrowser(orgSlug, repoSlug, token),
    enabled: Boolean(orgSlug && repoSlug),
  })

  const browser = browserData?.browser
  const refList =
    refKind === 'tag'
      ? browser?.tags ?? []
      : browser?.branches.length
        ? browser.branches
        : [defaultBranch]
  const ref = refOverride ?? browser?.default_ref ?? defaultBranch
  const activeRef = refList.includes(ref) ? ref : (refList[0] ?? ref)
  const canBrowse = Boolean(browser && !browser.empty && (refKind === 'branch' || refList.length > 0))
  const canEdit = Boolean(token && refKind === 'branch')

  const { data: treeData, isLoading: treeLoading } = useQuery({
    queryKey: ['repo-tree', orgSlug, repoSlug, refKind, activeRef, path, token ?? 'public'],
    queryFn: () => api.getRepoTree(orgSlug, repoSlug, { ref: activeRef, path, ref_kind: refKind }, token),
    enabled: canBrowse && !inEditMode,
  })

  const readmePath =
    path === '' && !inEditMode && treeData?.entries ? findReadmePath(treeData.entries) : null

  const pathParts = path ? path.split('/') : []
  const branchCount = browser?.branches.length ?? 0
  const tagCount = browser?.tags.length ?? 0

  const expandPath = useCallback((filePath: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev)
      for (const folder of ancestorPathsForFile(filePath)) {
        next.add(folder)
      }
      return next
    })
  }, [])

  const openFile = useCallback(
    async (filePath: string, options?: { isNew?: boolean; content?: string }) => {
      expandPath(filePath)
      setActivePath(filePath)
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev)
        next.set('file', filePath)
        return next
      }, { replace: true })

      if (openFilesRef.current.some((file) => file.path === filePath)) return

      if (options?.isNew) {
        const content = options.content ?? ''
        setOpenFiles((prev) => [
          ...prev,
          { path: filePath, content, savedContent: content, isBinary: false, isNew: true },
        ])
        return
      }

      setLoadingPath(filePath)
      try {
        const blob = await api.getRepoBlob(
          orgSlug,
          repoSlug,
          { ref: activeRef, path: filePath, ref_kind: refKind },
          token,
        )
        setOpenFiles((prev) => {
          if (prev.some((file) => file.path === filePath)) return prev
          return [
            ...prev,
            {
              path: filePath,
              content: blob.content,
              savedContent: blob.content,
              isBinary: blob.is_binary,
            },
          ]
        })
      } finally {
        setLoadingPath((current) => (current === filePath ? null : current))
      }
    },
    [activeRef, expandPath, orgSlug, refKind, repoSlug, setSearchParams, token],
  )

  useEffect(() => {
    if (!initialFile || !canBrowse) return
    void openFile(initialFile)
  }, [initialFile, canBrowse]) // eslint-disable-line react-hooks/exhaustive-deps -- open once on load

  useEffect(() => {
    if (initialFile) return
    setOpenFiles([])
    setActivePath(null)
  }, [activeRef, refKind, initialFile])

  const navigateTo = useCallback((newPath: string) => {
    setPath(newPath)
  }, [])

  const openEntry = useCallback(
    (entry: TreeEntry) => {
      if (entry.kind === 'tree') {
        navigateTo(entry.path)
        return
      }
      void openFile(entry.path)
    },
    [navigateTo, openFile],
  )

  const exitEditMode = useCallback(() => {
    setOpenFiles([])
    setActivePath(null)
    setShowNewFile(false)
    setSearchParams((params) => {
      const updated = new URLSearchParams(params)
      updated.delete('file')
      return updated
    }, { replace: true })
  }, [setSearchParams])

  const toggleExpand = useCallback((folderPath: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev)
      if (next.has(folderPath)) {
        next.delete(folderPath)
      } else {
        next.add(folderPath)
      }
      return next
    })
  }, [])

  const closeFile = useCallback(
    (filePath: string) => {
      setOpenFiles((prev) => {
        const next = prev.filter((file) => file.path !== filePath)
        if (activePath === filePath) {
          const closedIndex = prev.findIndex((file) => file.path === filePath)
          const fallback = next[closedIndex] ?? next[closedIndex - 1] ?? null
          if (fallback) {
            setActivePath(fallback.path)
            setSearchParams((params) => {
              const updated = new URLSearchParams(params)
              updated.set('file', fallback.path)
              return updated
            }, { replace: true })
          } else {
            exitEditMode()
          }
        }
        return next
      })
    },
    [activePath, exitEditMode, setSearchParams],
  )

  const handleSaved = useCallback(
    (filePath: string, content: string) => {
      setOpenFiles((prev) =>
        prev.map((file) =>
          file.path === filePath
            ? { ...file, content, savedContent: content, isNew: false }
            : file,
        ),
      )
      queryClient.invalidateQueries({ queryKey: ['repo-tree', orgSlug, repoSlug] })
      queryClient.invalidateQueries({ queryKey: ['repo-blob', orgSlug, repoSlug] })
      queryClient.invalidateQueries({ queryKey: ['repo-browser', orgSlug, repoSlug] })
    },
    [orgSlug, queryClient, repoSlug],
  )

  const resetBrowseState = useCallback(() => {
    setPath('')
    setOpenFiles([])
    setActivePath(null)
    setExpandedPaths(new Set())
    setShowNewFile(false)
    setSearchParams((params) => {
      const updated = new URLSearchParams(params)
      updated.delete('file')
      return updated
    }, { replace: true })
  }, [setSearchParams])

  const toolbar = (
    <div className="app-toolbar">
      {inEditMode && (
        <SecondaryButton
          type="button"
          className="!py-1 !px-2 !text-xs shrink-0"
          onClick={exitEditMode}
        >
          <ArrowLeft size={14} />
          Files
        </SecondaryButton>
      )}

      <div className="app-ref-toolbar-group">
        <RefSelect
          id="repo-ref-select"
          refKind={refKind}
          refName={activeRef}
          branches={browser?.branches ?? []}
          tags={browser?.tags ?? []}
          fallbackRef={defaultBranch}
          disabled={!browser || browser.empty}
          onChange={(kind, name) => {
            setRefKind(kind)
            setRefOverride(name)
            resetBrowseState()
          }}
        />
        <span className="app-ref-select-meta text-xs text-text-secondary whitespace-nowrap">
          {branchCount} branch{branchCount === 1 ? '' : 'es'} · {tagCount} tag
          {tagCount === 1 ? '' : 's'}
        </span>
      </div>

      {!inEditMode && pathParts.length > 0 && (
        <div className="app-path-crumb flex-1 min-w-0">
          <button type="button" onClick={() => navigateTo('')} aria-label="Repository root">
            /
          </button>
          {pathParts.map((part, i) => {
            const subPath = pathParts.slice(0, i + 1).join('/')
            return (
              <span key={subPath} className="inline-flex items-center gap-1">
                <ChevronRight size={12} className="text-muted" />
                <button type="button" onClick={() => navigateTo(subPath)}>
                  {part}
                </button>
              </span>
            )
          })}
        </div>
      )}

      {refKind === 'tag' && (
        <span className="text-xs text-text-secondary">Tags are read-only</span>
      )}
    </div>
  )

  if (browserLoading) {
    return (
      <div className="app-panel">
        <div className="app-panel-body flex items-center gap-2 text-text-secondary text-sm">
          <Loader2 size={16} className="animate-spin" />
          Loading repository…
        </div>
      </div>
    )
  }

  if (browser?.empty) {
    return (
      <div className="app-panel">
        <div className="app-panel-body py-10 px-4 sm:px-6">
          {cloneUrl && authCloneUrl ? (
            <RepoClonePushGuide
              cloneUrl={cloneUrl}
              authCloneUrl={authCloneUrl}
              cloneUrlSsh={cloneUrlSsh}
              defaultBranch={defaultBranch}
              isPrivate={isPrivate}
            />
          ) : (
            <div className="text-center py-6">
              <Folder size={40} className="mx-auto text-muted opacity-50 mb-3" />
              <p className="text-sm text-text-secondary">Loading clone instructions…</p>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4 min-w-0">
      <div className="app-panel">
        {toolbar}

        {inEditMode ? (
          <div className="repo-explorer">
            <aside className="repo-explorer-sidebar">
              <div className="repo-explorer-sidebar-header">
                <span>Explorer</span>
                {canEdit && (
                  <SecondaryButton
                    type="button"
                    className="!py-0.5 !px-2 !text-xs"
                    onClick={() => setShowNewFile(true)}
                  >
                    <FilePlus size={12} />
                    New
                  </SecondaryButton>
                )}
              </div>
              {showNewFile && (
                <NewFileBar
                  onCancel={() => setShowNewFile(false)}
                  onCreate={(filePath) => {
                    setShowNewFile(false)
                    void openFile(filePath, { isNew: true, content: '' })
                  }}
                />
              )}
              {canBrowse ? (
                <RepoFileTree
                  orgSlug={orgSlug}
                  repoSlug={repoSlug}
                  ref={activeRef}
                  refKind={refKind}
                  token={token}
                  selectedPath={activePath}
                  expandedPaths={expandedPaths}
                  onToggleExpand={toggleExpand}
                  onSelectFile={(filePath) => void openFile(filePath)}
                />
              ) : (
                <p className="px-3 py-2 text-xs text-text-secondary">No refs available</p>
              )}
            </aside>

            <div className="repo-explorer-main">
              <RepoFileEditor
                token={token}
                orgSlug={orgSlug}
                repoSlug={repoSlug}
                branch={activeRef}
                refKind={refKind}
                canEdit={canEdit}
                openFiles={openFiles}
                activePath={activePath}
                loadingPath={loadingPath}
                onActivePathChange={(filePath) => {
                  setActivePath(filePath)
                  setSearchParams((params) => {
                    const updated = new URLSearchParams(params)
                    updated.set('file', filePath)
                    return updated
                  }, { replace: true })
                }}
                onCloseFile={closeFile}
                onUpdateContent={(filePath, content) => {
                  setOpenFiles((prev) =>
                    prev.map((file) => (file.path === filePath ? { ...file, content } : file)),
                  )
                }}
                onSaved={handleSaved}
              />
            </div>
          </div>
        ) : (
          <>
            {treeLoading ? (
              <div className="flex items-center gap-2 text-text-secondary text-sm p-6">
                <Loader2 size={16} className="animate-spin" />
                Loading files…
              </div>
            ) : (
              <table className="app-file-table app-file-table-commits">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th className="hidden md:table-cell">Last commit message</th>
                    <th className="w-32 text-right hidden md:table-cell" aria-label="Last edit" />
                  </tr>
                </thead>
                <tbody>
                  {(treeData?.entries ?? []).map((entry) => (
                    <tr key={entry.path} onClick={() => openEntry(entry)}>
                      <td>
                        <span className="name-cell">
                          <RepoEntryIcon name={entry.name} kind={entry.kind} />
                          {entry.name}
                        </span>
                        {entry.last_commit && (
                          <div className="md:hidden flex items-start justify-between gap-3 text-xs text-text-secondary mt-0.5 pl-[1.35rem] min-w-0">
                            <span className="truncate">{entry.last_commit.message}</span>
                            <span className="shrink-0 whitespace-nowrap">
                              {formatRelativeTime(entry.last_commit.committed_at)}
                            </span>
                          </div>
                        )}
                      </td>
                      <td className="hidden md:table-cell text-text-secondary text-sm">
                        {entry.last_commit ? (
                          <Link
                            to={commitUrl(orgSlug, repoSlug, entry.last_commit.sha)}
                            className="hover:text-primary hover:underline truncate block max-w-md"
                            onClick={(e) => e.stopPropagation()}
                            title={entry.last_commit.message}
                          >
                            {entry.last_commit.message}
                          </Link>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="text-right text-text-secondary text-sm whitespace-nowrap hidden md:table-cell">
                        {entry.last_commit ? formatRelativeTime(entry.last_commit.committed_at) : '—'}
                      </td>
                    </tr>
                  ))}
                  {(treeData?.entries ?? []).length === 0 && (
                    <tr>
                      <td colSpan={3} className="text-center text-text-secondary py-8">
                        This folder is empty.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>

      {readmePath && !inEditMode && (
        <RepoReadme
          token={token}
          orgSlug={orgSlug}
          repoSlug={repoSlug}
          ref={activeRef}
          refKind={refKind}
          readmePath={readmePath}
        />
      )}
    </div>
  )
}
