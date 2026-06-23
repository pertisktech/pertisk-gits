import { useQuery } from '@tanstack/react-query'
import {
  ChevronRight,
  Download,
  File,
  Folder,
  GitCommit,
  Loader2,
} from 'lucide-react'
import { useState } from 'react'
import { api } from '../api/client'
import type { TreeEntry } from '../api/types'
import { findReadmePath } from '../lib/readme'
import { RepoReadme } from './RepoReadme'

function formatBytes(size: number | null) {
  if (size == null) return '—'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(ts: number) {
  return new Date(ts * 1000).toLocaleString()
}

interface RepoBrowserProps {
  token: string
  orgSlug: string
  repoSlug: string
  defaultBranch: string
}

export function RepoBrowser({ token, orgSlug, repoSlug, defaultBranch }: RepoBrowserProps) {
  const [path, setPath] = useState('')
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [refOverride, setRefOverride] = useState<string | null>(null)
  const [refKind, setRefKind] = useState<'branch' | 'tag'>('branch')

  const { data: browserData, isLoading: browserLoading } = useQuery({
    queryKey: ['repo-browser', orgSlug, repoSlug],
    queryFn: () => api.getRepoBrowser(token, orgSlug, repoSlug),
    enabled: Boolean(token),
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
  const canBrowse = Boolean(token && browser && !browser.empty && (refKind === 'branch' || refList.length > 0))

  const { data: treeData, isLoading: treeLoading } = useQuery({
    queryKey: ['repo-tree', orgSlug, repoSlug, refKind, activeRef, path],
    queryFn: () => api.getRepoTree(token, orgSlug, repoSlug, { ref: activeRef, path, ref_kind: refKind }),
    enabled: canBrowse,
  })

  const { data: commitsData } = useQuery({
    queryKey: ['repo-commits', orgSlug, repoSlug, refKind, activeRef],
    queryFn: () => api.getRepoCommits(token, orgSlug, repoSlug, { ref: activeRef, limit: 10, ref_kind: refKind }),
    enabled: canBrowse && refKind === 'branch',
  })

  const { data: blobData, isLoading: blobLoading } = useQuery({
    queryKey: ['repo-blob', orgSlug, repoSlug, refKind, activeRef, selectedFile],
    queryFn: () =>
      api.getRepoBlob(token, orgSlug, repoSlug, {
        ref: activeRef,
        path: selectedFile!,
        ref_kind: refKind,
      }),
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
  const latestCommit = commitsData?.commits[0]
  const readmePath =
    path === '' && !selectedFile && treeData?.entries
      ? findReadmePath(treeData.entries)
      : null

  if (browserLoading) {
    return (
      <div className="gogs-panel">
        <div className="gogs-panel-body flex items-center gap-2 text-text-secondary text-sm">
          <Loader2 size={16} className="animate-spin" />
          Loading repository…
        </div>
      </div>
    )
  }

  if (browser?.empty) {
    return (
      <div className="gogs-panel">
        <div className="gogs-panel-body text-center py-12">
          <Folder size={40} className="mx-auto text-muted opacity-50 mb-3" />
          <p className="text-text font-medium">This repository is empty</p>
          <p className="text-sm text-text-secondary mt-1 max-w-md mx-auto">
            Push your first commit using the clone panel, then files will appear here.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4 min-w-0">
      <div className="gogs-panel">
        {latestCommit && (
          <div className="gogs-commit-row">
            <GitCommit size={14} className="text-primary shrink-0" />
            <span className="font-mono text-text">{latestCommit.short_sha}</span>
            <span className="truncate flex-1 text-text-secondary">{latestCommit.message}</span>
            <span className="shrink-0 text-muted hidden sm:inline">
              {formatDate(latestCommit.committed_at)}
            </span>
          </div>
        )}

        <div className="gogs-toolbar">
          <select
            id="ref-kind-select"
            value={refKind}
            onChange={(e) => {
              const kind = e.target.value as 'branch' | 'tag'
              setRefKind(kind)
              setRefOverride(null)
              navigateTo('')
            }}
            className="gogs-branch-select"
            aria-label="Reference type"
          >
            <option value="branch">Branch</option>
            <option value="tag">Tag</option>
          </select>

          <select
            id="branch-select"
            value={activeRef}
            onChange={(e) => {
              setRefOverride(e.target.value)
              navigateTo('')
            }}
            className="gogs-branch-select min-w-[8rem]"
            disabled={refList.length === 0}
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
          </select>

          <div className="gogs-path-crumb flex-1 min-w-0">
            <button type="button" onClick={() => navigateTo('')}>
              {repoSlug}
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
        </div>

        {treeLoading ? (
          <div className="flex items-center gap-2 text-text-secondary text-sm p-6">
            <Loader2 size={16} className="animate-spin" />
            Loading files…
          </div>
        ) : (
          <table className="gogs-file-table">
            <thead>
              <tr>
                <th>Name</th>
                <th className="w-28 text-right hidden sm:table-cell">Size</th>
              </tr>
            </thead>
            <tbody>
              {(treeData?.entries ?? []).map((entry) => (
                <tr key={entry.path} onClick={() => openEntry(entry)}>
                  <td>
                    <span className="name-cell">
                      {entry.kind === 'tree' ? (
                        <Folder size={15} className="text-primary shrink-0" />
                      ) : (
                        <File size={15} className="text-muted shrink-0" />
                      )}
                      {entry.name}
                    </span>
                  </td>
                  <td className="text-right text-text-secondary hidden sm:table-cell">
                    {entry.kind === 'tree' ? '—' : formatBytes(entry.size)}
                  </td>
                </tr>
              ))}
              {(treeData?.entries ?? []).length === 0 && (
                <tr>
                  <td colSpan={2} className="text-center text-text-secondary py-8">
                    This folder is empty.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
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
        <div className="gogs-panel">
          <div className="gogs-panel-header flex items-center justify-between gap-2">
            <span className="font-mono text-xs truncate">{selectedFile}</span>
            <a
              href={api.repoRawUrl(orgSlug, repoSlug, {
                ref: activeRef,
                path: selectedFile,
                ref_kind: refKind,
              })}
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline shrink-0"
              onClick={(e) => {
                e.preventDefault()
                const url = api.repoRawUrl(orgSlug, repoSlug, {
                  ref: activeRef,
                  path: selectedFile,
                  ref_kind: refKind,
                })
                fetch(url, { headers: { Authorization: `Bearer ${token}` } })
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
          <div className="gogs-panel-body">
            {blobLoading ? (
              <div className="flex items-center gap-2 text-text-secondary text-sm">
                <Loader2 size={16} className="animate-spin" />
                Loading file…
              </div>
            ) : blobData?.is_binary ? (
              <p className="text-sm text-text-secondary">Binary file — preview not available.</p>
            ) : (
              <pre className="m-0 p-3 rounded-md bg-bg border border-border font-mono text-xs text-text overflow-x-auto leading-relaxed whitespace-pre-wrap">
                {blobData?.content ?? ''}
              </pre>
            )}
          </div>
        </div>
      )}

      {commitsData && commitsData.commits.length > 1 && refKind === 'branch' && (
        <div className="gogs-panel">
          <div className="gogs-panel-header flex items-center gap-2">
            <GitCommit size={14} className="text-primary" />
            Recent commits
          </div>
          <ul className="divide-y divide-border">
            {commitsData.commits.slice(1).map((commit) => (
              <li key={commit.sha} className="px-4 py-3 text-sm">
                <div className="flex items-start gap-2">
                  <GitCommit size={14} className="text-primary shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <div className="text-text">{commit.message}</div>
                    <div className="text-xs text-text-secondary mt-0.5 flex flex-wrap gap-x-2">
                      <span className="font-mono">{commit.short_sha}</span>
                      <span>{commit.author_name}</span>
                      <span>{formatDate(commit.committed_at)}</span>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
