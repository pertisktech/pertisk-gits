import { useQuery } from '@tanstack/react-query'
import {
  ChevronRight,
  File,
  Folder,
  GitCommit,
  Loader2,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { TreeEntry } from '../api/types'
import { Card } from '../components/Card'

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
  const [ref, setRef] = useState(defaultBranch)
  const [path, setPath] = useState('')
  const [selectedFile, setSelectedFile] = useState<string | null>(null)

  const { data: browserData, isLoading: browserLoading } = useQuery({
    queryKey: ['repo-browser', orgSlug, repoSlug],
    queryFn: () => api.getRepoBrowser(token, orgSlug, repoSlug),
    enabled: Boolean(token),
  })

  const browser = browserData?.browser

  useEffect(() => {
    if (browser?.default_ref) {
      setRef(browser.default_ref)
    }
  }, [browser?.default_ref])

  const { data: treeData, isLoading: treeLoading } = useQuery({
    queryKey: ['repo-tree', orgSlug, repoSlug, ref, path],
    queryFn: () => api.getRepoTree(token, orgSlug, repoSlug, { ref, path }),
    enabled: Boolean(token && browser && !browser.empty),
  })

  const { data: commitsData } = useQuery({
    queryKey: ['repo-commits', orgSlug, repoSlug, ref],
    queryFn: () => api.getRepoCommits(token, orgSlug, repoSlug, { ref, limit: 10 }),
    enabled: Boolean(token && browser && !browser.empty),
  })

  const { data: blobData, isLoading: blobLoading } = useQuery({
    queryKey: ['repo-blob', orgSlug, repoSlug, ref, selectedFile],
    queryFn: () =>
      api.getRepoBlob(token, orgSlug, repoSlug, { ref, path: selectedFile! }),
    enabled: Boolean(token && selectedFile && browser && !browser.empty),
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

  if (browserLoading) {
    return (
      <Card title="Repository">
        <div className="flex items-center gap-2 text-text-secondary text-sm">
          <Loader2 size={16} className="animate-spin" />
          Loading repository…
        </div>
      </Card>
    )
  }

  if (browser?.empty) {
    return (
      <Card title="Repository">
        <div className="text-center py-10">
          <Folder size={40} className="mx-auto text-text-secondary/50 mb-3" />
          <p className="text-text font-medium">This repository is empty</p>
          <p className="text-sm text-text-secondary mt-1 max-w-md mx-auto">
            Push your first commit using the Clone tab, then files and history will appear here.
          </p>
        </div>
      </Card>
    )
  }

  const latestCommit = commitsData?.commits[0]

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center gap-3 justify-between mb-4">
          <div className="flex items-center gap-2 flex-wrap">
            <label className="text-sm text-text-secondary" htmlFor="branch-select">
              Branch
            </label>
            <select
              id="branch-select"
              value={ref}
              onChange={(e) => {
                setRef(e.target.value)
                navigateTo('')
              }}
              className="px-2.5 py-1.5 rounded-lg border border-border bg-bg text-sm text-text font-mono"
            >
              {(browser?.branches.length ? browser.branches : [defaultBranch]).map((branch) => (
                <option key={branch} value={branch}>
                  {branch}
                </option>
              ))}
            </select>
          </div>
          {latestCommit && (
            <div className="flex items-center gap-2 text-sm text-text-secondary min-w-0">
              <GitCommit size={14} className="shrink-0 text-primary" />
              <span className="font-mono text-text">{latestCommit.short_sha}</span>
              <span className="truncate">{latestCommit.message}</span>
              <span className="shrink-0 hidden sm:inline">
                · {formatDate(latestCommit.committed_at)}
              </span>
            </div>
          )}
        </div>

        <nav className="flex items-center gap-1 text-sm mb-3 flex-wrap">
          <button
            type="button"
            onClick={() => navigateTo('')}
            className="text-primary hover:underline font-mono"
          >
            {repoSlug}
          </button>
          {pathParts.map((part, i) => {
            const subPath = pathParts.slice(0, i + 1).join('/')
            return (
              <span key={subPath} className="flex items-center gap-1">
                <ChevronRight size={14} className="text-text-secondary" />
                <button
                  type="button"
                  onClick={() => navigateTo(subPath)}
                  className="text-primary hover:underline font-mono"
                >
                  {part}
                </button>
              </span>
            )
          })}
        </nav>

        {treeLoading ? (
          <div className="flex items-center gap-2 text-text-secondary text-sm py-6">
            <Loader2 size={16} className="animate-spin" />
            Loading files…
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-hover/50 text-left text-text-secondary">
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium w-28 text-right hidden sm:table-cell">
                    Size
                  </th>
                </tr>
              </thead>
              <tbody>
                {(treeData?.entries ?? []).map((entry) => (
                  <tr
                    key={entry.path}
                    className="border-b border-border last:border-0 hover:bg-hover cursor-pointer"
                    onClick={() => openEntry(entry)}
                  >
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-2 text-text">
                        {entry.kind === 'tree' ? (
                          <Folder size={16} className="text-primary shrink-0" />
                        ) : (
                          <File size={16} className="text-text-secondary shrink-0" />
                        )}
                        <span className="font-mono text-sm">{entry.name}</span>
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right text-text-secondary hidden sm:table-cell">
                      {entry.kind === 'tree' ? '—' : formatBytes(entry.size)}
                    </td>
                  </tr>
                ))}
                {(treeData?.entries ?? []).length === 0 && (
                  <tr>
                    <td colSpan={2} className="px-3 py-6 text-center text-text-secondary">
                      This folder is empty.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {selectedFile && (
        <Card title={selectedFile}>
          {blobLoading ? (
            <div className="flex items-center gap-2 text-text-secondary text-sm">
              <Loader2 size={16} className="animate-spin" />
              Loading file…
            </div>
          ) : blobData?.is_binary ? (
            <p className="text-sm text-text-secondary">Binary file — preview not available.</p>
          ) : (
            <pre className="m-0 p-4 rounded-lg bg-bg border border-border font-mono text-xs text-text overflow-x-auto leading-relaxed whitespace-pre-wrap">
              {blobData?.content ?? ''}
            </pre>
          )}
        </Card>
      )}

      {commitsData && commitsData.commits.length > 0 && (
        <Card title="Recent commits">
          <ul className="divide-y divide-border">
            {commitsData.commits.map((commit) => (
              <li key={commit.sha} className="py-3 first:pt-0 last:pb-0">
                <div className="flex items-start gap-3">
                  <GitCommit size={16} className="text-primary shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-text">{commit.message}</div>
                    <div className="text-xs text-text-secondary mt-1 flex flex-wrap gap-x-2">
                      <span className="font-mono">{commit.short_sha}</span>
                      <span>{commit.author_name}</span>
                      <span>{formatDate(commit.committed_at)}</span>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}
