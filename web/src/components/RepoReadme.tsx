import { useQuery } from '@tanstack/react-query'
import { FileText, Loader2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api } from '../api/client'

interface RepoReadmeProps {
  token?: string | null
  orgSlug: string
  repoSlug: string
  ref: string
  refKind?: 'branch' | 'tag'
  readmePath: string
}

export function RepoReadme({
  token,
  orgSlug,
  repoSlug,
  ref,
  refKind = 'branch',
  readmePath,
}: RepoReadmeProps) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['repo-readme', orgSlug, repoSlug, refKind, ref, readmePath],
    queryFn: () =>
      api.getRepoBlob(orgSlug, repoSlug, { ref, path: readmePath, ref_kind: refKind }, token),
    enabled: Boolean(readmePath),
    retry: false,
  })

  if (isLoading) {
    return (
      <div className="app-panel">
        <div className="app-panel-header flex items-center gap-2">
          <FileText size={14} className="text-primary" />
          {readmePath}
        </div>
        <div className="app-panel-body flex items-center gap-2 text-text-secondary text-sm">
          <Loader2 size={16} className="animate-spin" />
          Loading README…
        </div>
      </div>
    )
  }

  if (isError || !data || data.is_binary) {
    return null
  }

  return (
    <div className="app-panel markdown-viewer">
      <div className="app-panel-header flex items-center gap-2">
        <FileText size={14} className="text-primary" />
        {readmePath}
      </div>
      <div className="app-panel-body markdown-viewer-content text-sm text-text">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{data.content}</ReactMarkdown>
      </div>
    </div>
  )
}
