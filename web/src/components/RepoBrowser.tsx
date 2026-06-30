import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  FilePlus,
  Folder,
  FolderPlus,
  Loader2,
  PanelLeft,
  PanelLeftClose,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import type { EntryLastCommit, TreeEntry } from '../api/types'
import { findReadmePath } from '../lib/readme'
import { formatBytes } from '../lib/formatBytes'
import { formatRelativeTime } from '../lib/relativeTime'
import { commitUrl } from './RepoCommits'
import { CreateRepoEntryDialog, type RepoEntryKind } from './CreateRepoEntryDialog'
import { mergeTreeEntries } from '../lib/pendingTreeEntries'
import { ancestorPathsForFile, RepoFileTree } from './RepoFileTree'
import { RepoFileEditor, type OpenFileState } from './RepoFileEditor'
import { RepoFilePreview } from './RepoFilePreview'
import { RepoFindFilePopover } from './RepoFindFilePopover'
import { RepoClonePushGuide } from './RepoClonePushGuide'
import { RepoEntryIcon } from './RepoEntryIcon'
import { RepoPathBreadcrumb } from './RepoPathBreadcrumb'
import { RepoReadme } from './RepoReadme'
import { RepoRefHeadSummary } from './RepoRefHeadSummary'
import { SecondaryButton, RefSelect } from './ui'
import { cn } from '../utils/cn'

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
  const urlRef = searchParams.get('ref')
  const refKind: 'branch' | 'tag' =
    urlRef && searchParams.get('ref_kind') === 'tag' ? 'tag' : 'branch'

  const [path, setPath] = useState(() => {
    if (!initialFile) return ''
    const slash = initialFile.lastIndexOf('/')
    return slash >= 0 ? initialFile.slice(0, slash) : ''
  })
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set())
  const [openFiles, setOpenFiles] = useState<OpenFileState[]>([])
  const [activePath, setActivePath] = useState<string | null>(initialFile)
  const [editorOpen, setEditorOpen] = useState(false)
  const [showTree, setShowTree] = useState(false)
  const [viewingMeta, setViewingMeta] = useState<EntryLastCommit | null | undefined>(undefined)
  const [loadingPath, setLoadingPath] = useState<string | null>(null)
  const [createEntryKind, setCreateEntryKind] = useState<RepoEntryKind | null>(null)
  const [createEntryPending, setCreateEntryPending] = useState(false)
  const [createEntryError, setCreateEntryError] = useState<string | null>(null)
  const [findFileOpen, setFindFileOpen] = useState(false)
  const localNewPathsRef = useRef(new Set<string>())
  const openFilesRef = useRef(openFiles)
  openFilesRef.current = openFiles

  const inEditMode = editorOpen
  const viewingPath = activePath && !editorOpen ? activePath : null

  const { data: browserData, isLoading: browserLoading } = useQuery({
    queryKey: ['repo-browser', orgSlug, repoSlug],
    queryFn: () => api.getRepoBrowser(orgSlug, repoSlug, token),
    enabled: Boolean(orgSlug && repoSlug),
  })

  const browser = browserData?.browser
  const defaultRef = browser?.default_ref ?? defaultBranch
  const refList =
    refKind === 'tag'
      ? browser?.tags ?? []
      : browser?.branches.length
        ? browser.branches
        : [defaultBranch]
  const ref = urlRef ?? defaultRef
  const activeRef = refList.includes(ref) ? ref : (urlRef ?? refList[0] ?? ref)
  const canBrowse = Boolean(browser && (refKind === 'branch' || refList.length > 0))
  const canEdit = Boolean(token && refKind === 'branch')

  const { data: treeData, isLoading: treeLoading } = useQuery({
    queryKey: ['repo-tree', orgSlug, repoSlug, refKind, activeRef, path, token ?? 'public'],
    queryFn: () => api.getRepoTree(orgSlug, repoSlug, { ref: activeRef, path, ref_kind: refKind }, token),
    enabled: canBrowse && !inEditMode,
  })

  const { data: viewBlob, isLoading: viewBlobLoading } = useQuery({
    queryKey: ['repo-blob', orgSlug, repoSlug, refKind, activeRef, viewingPath],
    queryFn: () =>
      api.getRepoBlob(
        orgSlug,
        repoSlug,
        { ref: activeRef, path: viewingPath!, ref_kind: refKind },
        token,
      ),
    enabled: Boolean(viewingPath && canBrowse),
  })

  const { data: headCommitData } = useQuery({
    queryKey: ['repo-ref-head', orgSlug, repoSlug, refKind, activeRef, token ?? 'public'],
    queryFn: () =>
      api.getRepoCommits(orgSlug, repoSlug, { ref: activeRef, ref_kind: refKind, limit: 1 }, token),
    enabled: canBrowse,
  })

  const headCommit = headCommitData?.commits[0]

  const readmePath =
    path === '' && !viewingPath && !inEditMode && treeData?.entries
      ? findReadmePath(treeData.entries)
      : null

  const pendingTreePaths = useMemo(
    () =>
      openFiles
        .filter((file) => file.isNew || file.content !== file.savedContent)
        .map((file) => file.path),
    [openFiles],
  )

  const browseEntries = useMemo(
    () =>
      mergeTreeEntries(treeData?.entries ?? [], path, pendingTreePaths).filter(
        (entry) => entry.name !== '.gitkeep',
      ),
    [treeData?.entries, path, pendingTreePaths],
  )

  const viewingEntry = useMemo(
    () => (viewingPath ? browseEntries.find((entry) => entry.path === viewingPath) : undefined),
    [browseEntries, viewingPath],
  )

  const viewingSizeBytes = useMemo(() => {
    if (viewingEntry?.size != null) return viewingEntry.size
    if (viewBlob && !viewBlob.is_binary) {
      return new TextEncoder().encode(viewBlob.content).length
    }
    return null
  }, [viewBlob, viewingEntry?.size])

  const expandPath = useCallback((filePath: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev)
      for (const folder of ancestorPathsForFile(filePath)) {
        next.add(folder)
      }
      return next
    })
  }, [])

  const patchSearchParams = useCallback(
    (patch: (next: URLSearchParams) => void) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev)
        patch(next)
        return next
      }, { replace: true })
    },
    [setSearchParams],
  )

  const syncFileParam = useCallback(
    (filePath: string | null) => {
      patchSearchParams((next) => {
        if (filePath) {
          next.set('file', filePath)
        } else {
          next.delete('file')
        }
      })
    },
    [patchSearchParams],
  )

  const viewFile = useCallback(
    (filePath: string, entry?: TreeEntry) => {
      const slash = filePath.lastIndexOf('/')
      const parentPath = slash >= 0 ? filePath.slice(0, slash) : ''
      expandPath(filePath)
      setPath(parentPath)
      setActivePath(filePath)
      setEditorOpen(false)
      setViewingMeta(entry?.last_commit ?? undefined)
      syncFileParam(filePath)
    },
    [expandPath, syncFileParam],
  )

  const openFileForEdit = useCallback(
    async (filePath: string, options?: { isNew?: boolean; content?: string }) => {
      expandPath(filePath)
      setActivePath(filePath)
      setEditorOpen(true)
      syncFileParam(filePath)

      if (openFilesRef.current.some((file) => file.path === filePath)) return

      if (options?.isNew) {
        const content = options.content ?? ''
        localNewPathsRef.current.add(filePath)
        setOpenFiles((prev) => [
          ...prev,
          { path: filePath, content, savedContent: content, isBinary: false, isNew: true },
        ])
        return
      }

      const cached = viewBlob && viewingPath === filePath ? viewBlob : null
      if (cached) {
        setOpenFiles((prev) => {
          if (prev.some((file) => file.path === filePath)) return prev
          return [
            ...prev,
            {
              path: filePath,
              content: cached.content,
              savedContent: cached.content,
              isBinary: cached.is_binary,
            },
          ]
        })
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
    [activeRef, expandPath, orgSlug, refKind, repoSlug, syncFileParam, token, viewBlob, viewingPath],
  )

  useEffect(() => {
    if (!initialFile || !canBrowse) return
    if (localNewPathsRef.current.has(initialFile)) return
    viewFile(initialFile)
  }, [initialFile, canBrowse]) // eslint-disable-line react-hooks/exhaustive-deps -- open once on load

  useEffect(() => {
    if (!viewingPath || viewingMeta !== undefined) return
    if (viewingEntry?.last_commit) {
      setViewingMeta(viewingEntry.last_commit)
    }
  }, [viewingPath, viewingEntry, viewingMeta])

  useEffect(() => {
    if (initialFile) return
    setOpenFiles([])
    setActivePath(null)
    setEditorOpen(false)
  }, [activeRef, refKind, initialFile])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 't' || event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target
      if (!(target instanceof HTMLElement)) return
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return
      }
      event.preventDefault()
      setFindFileOpen(true)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const navigateTo = useCallback(
    (newPath: string) => {
      setPath(newPath)
      setActivePath(null)
      setEditorOpen(false)
      setViewingMeta(undefined)
      syncFileParam(null)
    },
    [syncFileParam],
  )

  const openEntry = useCallback(
    (entry: TreeEntry) => {
      if (entry.kind === 'tree') {
        navigateTo(entry.path)
        return
      }
      viewFile(entry.path, entry)
    },
    [navigateTo, viewFile],
  )

  const exitEditMode = useCallback(() => {
    const editingNewOnly =
      openFilesRef.current.length > 0 && openFilesRef.current.every((file) => file.isNew)
    setEditorOpen(false)
    setOpenFiles([])
    setCreateEntryKind(null)
    if (editingNewOnly) {
      setActivePath(null)
      syncFileParam(null)
    }
  }, [syncFileParam])

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
            syncFileParam(fallback.path)
          } else {
            exitEditMode()
          }
        }
        return next
      })
    },
    [activePath, exitEditMode, syncFileParam],
  )

  const handleSaved = useCallback(
    async (filePath: string, content: string) => {
      localNewPathsRef.current.delete(filePath)
      setOpenFiles((prev) =>
        prev.map((file) =>
          file.path === filePath
            ? { ...file, content, savedContent: content, isNew: false }
            : file,
        ),
      )
      expandPath(filePath)
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ['repo-tree', orgSlug, repoSlug] }),
        queryClient.refetchQueries({ queryKey: ['repo-ref-head', orgSlug, repoSlug] }),
      ])
      queryClient.invalidateQueries({ queryKey: ['repo-blob', orgSlug, repoSlug] })
      queryClient.invalidateQueries({ queryKey: ['repo-browser', orgSlug, repoSlug] })
      setEditorOpen(false)
      setOpenFiles([])
      viewFile(filePath)
    },
    [expandPath, orgSlug, queryClient, repoSlug, viewFile],
  )

  const resetBrowseState = useCallback(() => {
    setPath('')
    setOpenFiles([])
    setActivePath(null)
    setEditorOpen(false)
    setExpandedPaths(new Set())
    setCreateEntryKind(null)
    setViewingMeta(undefined)
  }, [])

  const changeRef = useCallback(
    (kind: 'branch' | 'tag', name: string) => {
      patchSearchParams((next) => {
        next.delete('file')
        if (kind === 'branch' && name === defaultRef) {
          next.delete('ref')
          next.delete('ref_kind')
        } else {
          next.set('ref', name)
          if (kind === 'tag') {
            next.set('ref_kind', 'tag')
          } else {
            next.delete('ref_kind')
          }
        }
      })
      resetBrowseState()
    },
    [defaultRef, patchSearchParams, resetBrowseState],
  )

  const handleCreateEntry = useCallback(
    async (filePath: string) => {
      setCreateEntryError(null)
      const isFolder = filePath.endsWith('/.gitkeep')

      if (isFolder && token) {
        setCreateEntryPending(true)
        try {
          const folderPath = filePath.replace(/\/\.gitkeep$/, '')
          const folderName = folderPath.split('/').pop() ?? folderPath
          await api.commitRepoContents(token, orgSlug, repoSlug, {
            branch: activeRef,
            message: `Create folder ${folderName}`,
            changes: [{ path: filePath, content: '' }],
          })
          const parentPath = folderPath.includes('/')
            ? folderPath.slice(0, folderPath.lastIndexOf('/'))
            : ''
          setPath(parentPath)
          expandPath(filePath)
          await queryClient.refetchQueries({ queryKey: ['repo-tree', orgSlug, repoSlug] })
          queryClient.invalidateQueries({ queryKey: ['repo-ref-head', orgSlug, repoSlug] })
          queryClient.invalidateQueries({ queryKey: ['repo-browser', orgSlug, repoSlug] })
          setCreateEntryKind(null)
        } catch (err) {
          setCreateEntryError((err as Error).message)
          setCreateEntryKind(null)
          void openFileForEdit(filePath, { isNew: true, content: '' })
        } finally {
          setCreateEntryPending(false)
        }
        return
      }

      setCreateEntryKind(null)
      void openFileForEdit(filePath, { isNew: true, content: '' })
    },
    [activeRef, expandPath, openFileForEdit, orgSlug, queryClient, repoSlug, token],
  )

  const createEntryButtons = canEdit ? (
    <>
      <button
        type="button"
        className="app-toolbar-btn"
        title="New file"
        onClick={() => setCreateEntryKind('file')}
      >
        <FilePlus size={14} />
        <span className="sr-only">New file</span>
      </button>
      <button
        type="button"
        className="app-toolbar-btn"
        title="New folder"
        onClick={() => setCreateEntryKind('folder')}
      >
        <FolderPlus size={14} />
        <span className="sr-only">New folder</span>
      </button>
    </>
  ) : null

  const treeSidebar = canBrowse ? (
    <aside className="app-repo-files-sidebar">
      <div className="repo-explorer-sidebar-header">
        <span>Files</span>
        {canEdit && inEditMode && (
          <div className="flex items-center gap-1">
            <SecondaryButton
              type="button"
              className="!py-0.5 !px-2 !text-xs"
              title="New file"
              onClick={() => setCreateEntryKind('file')}
            >
              <FilePlus size={12} />
            </SecondaryButton>
            <SecondaryButton
              type="button"
              className="!py-0.5 !px-2 !text-xs"
              title="New folder"
              onClick={() => setCreateEntryKind('folder')}
            >
              <FolderPlus size={12} />
            </SecondaryButton>
          </div>
        )}
      </div>
      <RepoFileTree
        orgSlug={orgSlug}
        repoSlug={repoSlug}
        ref={activeRef}
        refKind={refKind}
        token={token}
        selectedPath={activePath}
        expandedPaths={expandedPaths}
        pendingPaths={pendingTreePaths}
        onToggleExpand={toggleExpand}
        onSelectFile={(filePath) => viewFile(filePath)}
      />
    </aside>
  ) : null

  const toolbar = (
    <div className="app-toolbar app-toolbar--repo">
      <div className="app-toolbar-row">
        {inEditMode && (
          <button type="button" className="app-toolbar-btn app-toolbar-btn--text" onClick={exitEditMode}>
            <ArrowLeft size={14} />
            <span className="hidden sm:inline">Back</span>
          </button>
        )}

        {!inEditMode && canBrowse && (
          <button
            type="button"
            className="app-toolbar-btn"
            title={showTree ? 'Hide file tree' : 'Show file tree'}
            onClick={() => setShowTree((value) => !value)}
          >
            {showTree ? <PanelLeftClose size={14} /> : <PanelLeft size={14} />}
            <span className="sr-only">Toggle file tree</span>
          </button>
        )}

        <div className="app-ref-toolbar-group">
          <RefSelect
            id="repo-ref-select"
            refKind={refKind}
            refName={activeRef}
            branches={browser?.branches ?? []}
            tags={browser?.tags ?? []}
            fallbackRef={defaultBranch}
            disabled={!browser}
            onChange={changeRef}
          />
        </div>

        {!inEditMode && (
          <RepoPathBreadcrumb
            folderPath={path}
            filePath={viewingPath}
            onNavigateFolder={navigateTo}
          />
        )}

        <div className="app-toolbar-right">
          {!inEditMode && (
            <RepoFindFilePopover
              token={token}
              orgSlug={orgSlug}
              repoSlug={repoSlug}
              open={findFileOpen}
              onOpenChange={setFindFileOpen}
              onSelectPath={(filePath) => viewFile(filePath)}
            />
          )}
          {createEntryButtons}
          {refKind === 'tag' && (
            <span className="text-xs text-text-secondary whitespace-nowrap">Tags are read-only</span>
          )}
        </div>
      </div>

      {headCommit && (
        <div className="app-toolbar-commit-row">
          <RepoRefHeadSummary orgSlug={orgSlug} repoSlug={repoSlug} commit={headCommit} />
        </div>
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

  return (
    <div className="space-y-4 min-w-0">
      <div className="app-panel">
        {toolbar}

        {inEditMode ? (
          <div className="repo-explorer">
            {treeSidebar}
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
                  syncFileParam(filePath)
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
          <div className={cn('app-repo-files-layout', showTree && canBrowse && 'app-repo-files-layout--tree')}>
            {showTree && treeSidebar}
            <div className="app-repo-files-main">
              {viewingPath ? (
                <RepoFilePreview
                  token={token}
                  orgSlug={orgSlug}
                  repoSlug={repoSlug}
                  ref={activeRef}
                  refKind={refKind}
                  path={viewingPath}
                  content={viewBlob?.content ?? ''}
                  isBinary={viewBlob?.is_binary ?? false}
                  loading={viewBlobLoading}
                  sizeBytes={viewingSizeBytes}
                  lastCommit={viewingMeta ?? viewingEntry?.last_commit}
                  canEdit={canEdit}
                  onEdit={() => void openFileForEdit(viewingPath)}
                />
              ) : treeLoading ? (
                <div className="flex items-center gap-2 text-text-secondary text-sm p-6">
                  <Loader2 size={16} className="animate-spin" />
                  Loading files…
                </div>
              ) : (
                <table className="app-file-table app-file-table-commits">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th className="w-24 text-right hidden lg:table-cell">Size</th>
                      <th className="hidden md:table-cell">Last commit message</th>
                      <th className="w-32 text-right hidden md:table-cell" aria-label="Last edit" />
                    </tr>
                  </thead>
                  <tbody>
                    {browseEntries.map((entry) => (
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
                        <td className="text-right text-text-secondary text-xs font-mono whitespace-nowrap hidden lg:table-cell">
                          {entry.kind === 'blob' && entry.size != null ? formatBytes(entry.size) : '—'}
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
                    {browseEntries.length === 0 && (
                      <tr>
                        <td colSpan={4} className="text-center text-text-secondary py-8">
                          {browser?.empty ? (
                            <div className="space-y-1">
                              <p>No files yet — this repository has no commits.</p>
                              <p className="text-xs">
                                Use <strong>New file</strong> or <strong>New folder</strong> in the toolbar to
                                create the first commit, or push from your computer below.
                              </p>
                            </div>
                          ) : (
                            'This folder is empty.'
                          )}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </div>

      {browser?.empty && !inEditMode && !viewingPath && (
        <div className="app-panel">
          <div className="app-panel-header">Push from your computer</div>
          <div className="app-panel-body py-6 px-4 sm:px-6">
            {cloneUrl && authCloneUrl ? (
              <RepoClonePushGuide
                cloneUrl={cloneUrl}
                authCloneUrl={authCloneUrl}
                cloneUrlSsh={cloneUrlSsh}
                defaultBranch={defaultBranch}
                isPrivate={isPrivate}
              />
            ) : (
              <div className="text-center py-4">
                <Folder size={40} className="mx-auto text-muted opacity-50 mb-3" />
                <p className="text-sm text-text-secondary">Loading clone instructions…</p>
              </div>
            )}
          </div>
        </div>
      )}

      {readmePath && !viewingPath && !inEditMode && (
        <RepoReadme
          token={token}
          orgSlug={orgSlug}
          repoSlug={repoSlug}
          ref={activeRef}
          refKind={refKind}
          readmePath={readmePath}
        />
      )}

      <CreateRepoEntryDialog
        open={createEntryKind !== null}
        kind={createEntryKind ?? 'file'}
        basePath={path}
        pending={createEntryPending}
        error={createEntryError}
        onClose={() => {
          if (createEntryPending) return
          setCreateEntryKind(null)
          setCreateEntryError(null)
        }}
        onCreate={handleCreateEntry}
      />
    </div>
  )
}
