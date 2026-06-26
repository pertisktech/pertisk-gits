import { useQuery } from '@tanstack/react-query'
import {
  ChevronRight,
  Download,
  File,
  Folder,
  Loader2,
} from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import type { TreeEntry } from '../api/types'
import { findReadmePath } from '../lib/readme'
import { formatRelativeTime } from '../lib/relativeTime'
import { commitUrl } from './RepoCommits'
import { CodeFileView } from './CodeFileView'
import { RepoReadme } from './RepoReadme'
import { Select } from './ui/Input'

interface RepoBrowserProps {
  token?: string | null
  orgSlug: string
  repoSlug: string
  defaultBranch: string
}

const compactSelect = '!w-auto !py-1.5 !text-theme-sm min-w-[8rem]'

export function RepoBrowser({
  token,
  orgSlug,
  repoSlug,
  defaultBranch,
}: RepoBrowserProps) {
  const [path, setPath] = useState('')
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [refOverride, setRefOverride] = useState<string | null>(null)
  const [refKind, setRefKind] = useState<'branch' | 'tag'>('branch')

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

  const { data: treeData, isLoading: treeLoading } = useQuery({
    queryKey: ['repo-tree', orgSlug, repoSlug, refKind, activeRef, path, token ?? 'public'],
    queryFn: () => api.getRepoTree(orgSlug, repoSlug, { ref: activeRef, path, ref_kind: refKind }, token),
    enabled: canBrowse,
  })

  const { data: blobData, isLoading: blobLoading } = useQuery({
    queryKey: ['repo-blob', orgSlug, repoSlug, refKind, activeRef, selectedFile, token ?? 'public'],
    queryFn: () =>
      api.getRepoBlob(orgSlug, repoSlug, {
        ref: activeRef,
        path: selectedFile!,
        ref_kind: refKind,
      }, token),
    enabled: Boolean(canBrowse && selectedFile),
  })

  function navigateTo(newPath: string) {
    setPath(newPath)
    setSelectedFile(null)
  }

  function openEntry(entry: TreeEntry) {
    if (entry.kind === 'tree') {
      navigateTo(entry.path)
      return
    }
    setSelectedFile(entry.path)
  }

  const pathParts = path ? path.split('/') : []
  const readmePath =
    path === '' && !selectedFile && treeData?.entries
      ? findReadmePath(treeData.entries)
      : null

  const branchCount = browser?.branches.length ?? 0
  const tagCount = browser?.tags.length ?? 0

  if (browserLoading) {
    return (
      <div className="shell-card">
        <div className="shell-card-body flex items-center gap-2 text-theme-sm text-gray-500 dark:text-gray-400">
          <Loader2 size={16} className="animate-spin" />
          Loading repository…
        </div>
      </div>
    )
  }

  if (browser?.empty) {
    return (
      <div className="shell-card">
        <div className="shell-card-body py-12 text-center">
          <Folder size={40} className="mx-auto mb-3 text-gray-400 opacity-50" />
          <p className="font-medium text-gray-800 dark:text-white/90">This repository is empty</p>
          <p className="mx-auto mt-1 max-w-md text-theme-sm text-gray-500 dark:text-gray-400">
            Push your first commit using the Code dropdown above, then files will appear here.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-w-0 space-y-4">
      <div className="shell-card">
        <div className="shell-repo-toolbar">
          <Select
            id="ref-kind-select"
            value={refKind}
            onChange={(e) => {
              const kind = e.target.value as 'branch' | 'tag'
              setRefKind(kind)
              setRefOverride(null)
              navigateTo('')
            }}
            className={compactSelect}
            aria-label="Reference type"
          >
            <option value="branch">Branch</option>
            <option value="tag">Tag</option>
          </Select>

          <Select
            id="branch-select"
            value={activeRef}
            onChange={(e) => {
              setRefOverride(e.target.value)
              navigateTo('')
            }}
            className={compactSelect}
            disabled={refList.length === 0}
            aria-label="Reference"
          >
            {refList.length === 0 ? (
              <option value={activeRef}>{refKind === 'tag' ? 'No tags' : activeRef}</option>
            ) : (
              refList.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))
            )}
          </Select>

          <span className="whitespace-nowrap text-theme-sm text-gray-500 dark:text-gray-400">
            {branchCount} Branch.{`  ${tagCount} Tags`}
          </span>

          {pathParts.length > 0 && (
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1 text-theme-sm">
              <button
                type="button"
                className="text-brand-500 hover:underline dark:text-brand-400"
                onClick={() => navigateTo('')}
                aria-label="Repository root"
              >
                /
              </button>
              {pathParts.map((part, i) => {
                const subPath = pathParts.slice(0, i + 1).join('/')
                return (
                  <span key={subPath} className="inline-flex items-center gap-1">
                    <ChevronRight size={12} className="text-gray-400" />
                    <button
                      type="button"
                      className="text-brand-500 hover:underline dark:text-brand-400"
                      onClick={() => navigateTo(subPath)}
                    >
                      {part}
                    </button>
                  </span>
                )
              })}
            </div>
          )}
        </div>

        {treeLoading ? (
          <div className="flex items-center gap-2 p-6 text-theme-sm text-gray-500 dark:text-gray-400">
            <Loader2 size={16} className="animate-spin" />
            Loading files…
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="shell-table shell-file-table w-full">
              <thead>
                <tr>
                  <th>Name</th>
                  <th className="hidden md:table-cell">Last commit message</th>
                  <th className="hidden w-32 text-right md:table-cell" aria-label="Last edit" />
                </tr>
              </thead>
              <tbody>
                {(treeData?.entries ?? []).map((entry) => (
                  <tr key={entry.path} onClick={() => openEntry(entry)}>
                    <td>
                      <span className="name-cell">
                        {entry.kind === 'tree' ? (
                          <Folder size={15} className="shrink-0 text-brand-500" />
                        ) : (
                          <File size={15} className="shrink-0 text-gray-400" />
                        )}
                        {entry.name}
                      </span>
                      {entry.last_commit && (
                        <div className="mt-0.5 flex min-w-0 items-start justify-between gap-3 pl-[1.35rem] text-theme-xs text-gray-500 dark:text-gray-400 md:hidden">
                          <span className="truncate">{entry.last_commit.message}</span>
                          <span className="shrink-0 whitespace-nowrap">
                            {formatRelativeTime(entry.last_commit.committed_at)}
                          </span>
                        </div>
                      )}
                    </td>
                    <td className="hidden text-theme-sm text-gray-500 dark:text-gray-400 md:table-cell">
                      {entry.last_commit ? (
                        <Link
                          to={commitUrl(orgSlug, repoSlug, entry.last_commit.sha)}
                          className="block max-w-md truncate text-brand-500 hover:underline dark:text-brand-400"
                          onClick={(e) => e.stopPropagation()}
                          title={entry.last_commit.message}
                        >
                          {entry.last_commit.message}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="hidden whitespace-nowrap text-right text-theme-sm text-gray-500 dark:text-gray-400 md:table-cell">
                      {entry.last_commit ? formatRelativeTime(entry.last_commit.committed_at) : '—'}
                    </td>
                  </tr>
                ))}
                {(treeData?.entries ?? []).length === 0 && (
                  <tr>
                    <td colSpan={3} className="py-8 text-center text-gray-500 dark:text-gray-400">
                      This folder is empty.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {readmePath && (
        <RepoReadme
          token={token}
          orgSlug={orgSlug}
          repoSlug={repoSlug}
          ref={activeRef}
          readmePath={readmePath}
        />
      )}

      {selectedFile && (
        <div className="shell-card">
          <div className="shell-card-header gap-2">
            <span className="truncate font-mono text-theme-xs">{selectedFile}</span>
            <a
              href={api.repoRawUrl(orgSlug, repoSlug, {
                ref: activeRef,
                path: selectedFile,
                ref_kind: refKind,
              })}
              className="inline-flex shrink-0 items-center gap-1 text-theme-xs text-brand-500 hover:underline dark:text-brand-400"
              onClick={(e) => {
                e.preventDefault()
                const url = api.repoRawUrl(orgSlug, repoSlug, {
                  ref: activeRef,
                  path: selectedFile,
                  ref_kind: refKind,
                })
                fetch(url, {
                  headers: token ? { Authorization: `Bearer ${token}` } : undefined,
                })
                  .then((res) => {
                    if (!res.ok) throw new Error('Download failed')
                    return res.blob()
                  })
                  .then((blob) => {
                    const objectUrl = URL.createObjectURL(blob)
                    const link = document.createElement('a')
                    link.href = objectUrl
                    link.download = selectedFile.split('/').pop() ?? 'file'
                    link.click()
                    URL.revokeObjectURL(objectUrl)
                  })
                  .catch(() => {
                    window.open(url, '_blank')
                  })
              }}
            >
              <Download size={12} />
              Raw
            </a>
          </div>
          <div className="shell-card-body flush">
            {blobLoading ? (
              <div className="flex items-center gap-2 p-4 text-theme-sm text-gray-500 dark:text-gray-400">
                <Loader2 size={16} className="animate-spin" />
                Loading file…
              </div>
            ) : blobData?.is_binary ? (
              <p className="p-4 text-theme-sm text-gray-500 dark:text-gray-400">
                Binary file — preview not available.
              </p>
            ) : (
              <CodeFileView path={selectedFile} content={blobData?.content ?? ''} />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
