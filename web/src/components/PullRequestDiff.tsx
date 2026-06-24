import { useMutation, useQueryClient } from '@tanstack/react-query'
import { MessageSquarePlus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { api } from '../api/client'
import type { PullRequestCommentDetail } from '../api/types'
import { MarkdownBody } from '../lib/collaboration'
import { parseUnifiedDiff } from '../lib/unifiedDiff'
import { PrimaryButton } from './ui'
import { DiffViewer } from './DiffViewer'
import { cn } from '../utils/cn'

interface PullRequestDiffProps {
  token?: string | null
  orgSlug: string
  repoSlug: string
  pullNumber: number
  diff: string
  comments: PullRequestCommentDetail[]
}

export function PullRequestDiff({
  token,
  orgSlug,
  repoSlug,
  pullNumber,
  diff,
  comments,
}: PullRequestDiffProps) {
  const queryClient = useQueryClient()
  const [activeLine, setActiveLine] = useState<{ path: string; line: number } | null>(null)
  const [draft, setDraft] = useState('')

  const files = useMemo(() => parseUnifiedDiff(diff), [diff])

  const commentsByLine = useMemo(() => {
    const map = new Map<string, PullRequestCommentDetail[]>()
    for (const item of comments) {
      if (!item.comment.path || item.comment.line == null) continue
      const key = `${item.comment.path}:${item.comment.line}`
      const bucket = map.get(key) ?? []
      bucket.push(item)
      map.set(key, bucket)
    }
    return map
  }, [comments])

  const commentMutation = useMutation({
    mutationFn: (payload: { path: string; line: number; body: string }) =>
      api.createPullRequestComment(token!, orgSlug, repoSlug, pullNumber, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pull-comments', orgSlug, repoSlug, pullNumber] })
      setActiveLine(null)
      setDraft('')
    },
  })

  if (files.length === 0) {
    return <pre className="app-diff m-0">{diff}</pre>
  }

  return (
    <DiffViewer
      diff={diff}
      renderLineActions={({ file, line }) => {
        if (!token || line.newLine == null) return null
        return (
          <button
            type="button"
            className="diff-view-line-comment-btn"
            title="Add review comment"
            onClick={() => {
              setActiveLine({ path: file.path, line: line.newLine! })
              setDraft('')
            }}
          >
            <MessageSquarePlus size={14} />
          </button>
        )
      }}
      renderAfterLine={({ file, line }) => {
        if (line.newLine == null || line.kind === 'hunk') return null

        const lineComments = commentsByLine.get(`${file.path}:${line.newLine}`)
        const isActive = activeLine?.path === file.path && activeLine.line === line.newLine

        return (
          <>
            {lineComments?.map(({ comment, author }) => (
              <div key={comment.id} className="diff-view-inline-comment">
                <div className="text-xs text-text-secondary mb-1">
                  <span className="font-medium text-text">{author.username}</span>
                </div>
                <MarkdownBody content={comment.body} orgSlug={orgSlug} repoSlug={repoSlug} />
              </div>
            ))}

            {isActive && (
              <form
                className="diff-view-inline-comment-form"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (!draft.trim() || !activeLine) return
                  commentMutation.mutate({
                    path: activeLine.path,
                    line: activeLine.line,
                    body: draft.trim(),
                  })
                }}
              >
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={3}
                  className="app-field w-full resize-y text-sm"
                  placeholder={`Comment on line ${activeLine.line}`}
                  required
                />
                <div className="flex gap-2">
                  <PrimaryButton type="submit" disabled={commentMutation.isPending}>
                    Add review comment
                  </PrimaryButton>
                  <button
                    type="button"
                    className={cn('text-sm text-text-secondary hover:text-text')}
                    onClick={() => setActiveLine(null)}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </>
        )
      }}
    />
  )
}
