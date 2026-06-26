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
      <div className="shell-card">
        <div className="shell-card-header flex items-center gap-2">
          <FileText size={14} className="text-brand-500" />
          {readmePath}
        </div>
        <div className="shell-card-body flex items-center gap-2 text-theme-sm text-gray-500 dark:text-gray-400">
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
    <div className="shell-card markdown-viewer">
      <div className="shell-card-header flex items-center gap-2">
        <FileText size={14} className="text-brand-500" />
        {readmePath}
      </div>
      <div className="markdown-viewer-content shell-card-body text-theme-sm text-gray-800 dark:text-white/90">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{data.content}</ReactMarkdown>
      </div>
    </div>
  )
}
