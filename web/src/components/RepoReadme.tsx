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
  readmePath: string
}

export function RepoReadme({ token, orgSlug, repoSlug, ref, readmePath }: RepoReadmeProps) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['repo-readme', orgSlug, repoSlug, ref, readmePath],
    queryFn: () => api.getRepoBlob(orgSlug, repoSlug, { ref, path: readmePath }, token),
    enabled: Boolean(readmePath),
  })

  if (isLoading) {
    return (
      <div className="gogs-panel">
        <div className="gogs-panel-header flex items-center gap-2">
          <FileText size={14} className="text-primary" />
          {readmePath}
        </div>
        <div className="gogs-panel-body flex items-center gap-2 text-text-secondary text-sm">
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
    <div className="gogs-panel markdown-viewer">
      <div className="gogs-panel-header flex items-center gap-2">
        <FileText size={14} className="text-primary" />
        {readmePath}
      </div>
      <div className="gogs-panel-body markdown-viewer-content text-sm text-text">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{data.content}</ReactMarkdown>
      </div>
    </div>
  )
}
