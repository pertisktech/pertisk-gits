import { useMutation, useQueryClient } from '@tanstack/react-query'
import { MessageSquarePlus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { api } from '../api/client'
import type { PullRequestCommentDetail } from '../api/types'
import { MarkdownBody } from '../lib/collaboration'
import { PrimaryButton } from './ui'
import { cn } from '../utils/cn'

interface DiffFile {
  path: string
  lines: Array<{
    kind: 'hunk' | 'add' | 'del' | 'ctx'
    text: string
    newLine?: number
  }>
}

function parseUnifiedDiff(diff: string): DiffFile[] {
  const files: DiffFile[] = []
  let current: DiffFile | null = null
  let newLine = 0

  for (const raw of diff.split('\n')) {
    if (raw.startsWith('diff --git ')) {
      current = { path: '', lines: [] }
      files.push(current)
      continue
    }
    if (!current) continue

    if (raw.startsWith('+++ b/')) {
      current.path = raw.slice(6)
      continue
    }
    if (raw.startsWith('@@')) {
      const match = raw.match(/\+(\d+)/)
      newLine = match ? Number.parseInt(match[1], 10) : 0
      current.lines.push({ kind: 'hunk', text: raw })
      continue
    }
    if (raw.startsWith('+') && !raw.startsWith('+++')) {
      current.lines.push({ kind: 'add', text: raw.slice(1), newLine })
      newLine += 1
      continue
    }
    if (raw.startsWith('-') && !raw.startsWith('---')) {
      current.lines.push({ kind: 'del', text: raw.slice(1) })
      continue
    }
    if (raw.startsWith(' ')) {
      current.lines.push({ kind: 'ctx', text: raw.slice(1), newLine })
      newLine += 1
    }
  }

  return files.filter((file) => file.path)
}

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
    <div className="divide-y divide-border">
      {files.map((file) => (
        <div key={file.path}>
          <div className="px-4 py-2 text-sm font-mono bg-hover border-b border-border text-text">
            {file.path}
          </div>
          <div className="font-mono text-xs overflow-x-auto">
            {file.lines.map((line, index) => {
              const lineKey =
                line.newLine != null ? `${file.path}:${line.newLine}` : `${file.path}:hunk:${index}`
              const lineComments =
                line.newLine != null ? commentsByLine.get(`${file.path}:${line.newLine}`) : undefined
              const isActive =
                activeLine?.path === file.path && activeLine.line === line.newLine

              return (
                <div key={lineKey}>
                  <div
                    className={cn(
                      'grid grid-cols-[3rem_1fr_auto] gap-2 px-4 py-0.5',
                      line.kind === 'add' && 'bg-dashboard-success-bg/40',
                      line.kind === 'del' && 'bg-dashboard-danger-bg/40',
                      line.kind === 'hunk' && 'text-primary bg-hover/50',
                    )}
                  >
                    <span className="text-muted text-right select-none">
                      {line.newLine ?? ''}
                    </span>
                    <span
                      className={cn(
                        'whitespace-pre-wrap break-all',
                        line.kind === 'add' && 'text-dashboard-success',
                        line.kind === 'del' && 'text-dashboard-danger',
                      )}
                    >
                      {line.kind === 'hunk' ? line.text : `${line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' '}${line.text}`}
                    </span>
                    {token && line.newLine != null && line.kind !== 'hunk' && (
                      <button
                        type="button"
                        className="text-muted hover:text-primary p-1"
                        title="Add review comment"
                        onClick={() => {
                          setActiveLine({ path: file.path, line: line.newLine! })
                          setDraft('')
                        }}
                      >
                        <MessageSquarePlus size={14} />
                      </button>
                    )}
                  </div>

                  {lineComments?.map(({ comment, author }) => (
                    <div
                      key={comment.id}
                      className="ml-12 mr-4 mb-2 p-3 rounded-md border border-border bg-surface text-sm"
                    >
                      <div className="text-xs text-text-secondary mb-1">
                        <span className="font-medium text-text">{author.username}</span>
                      </div>
                      <MarkdownBody content={comment.body} orgSlug={orgSlug} repoSlug={repoSlug} />
                    </div>
                  ))}

                  {isActive && (
                    <form
                      className="ml-12 mr-4 mb-3 space-y-2"
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
                          className="text-sm text-text-secondary hover:text-text"
                          onClick={() => setActiveLine(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
