import { useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export function issueUrl(orgSlug: string, repoSlug: string, number: number) {
  return `/groups/${orgSlug}/projects/${repoSlug}/issues/${number}`
}

export function pullUrl(orgSlug: string, repoSlug: string, number: number) {
  return `/groups/${orgSlug}/projects/${repoSlug}/pulls/${number}`
}

export function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString()
}

export interface CollaborationContext {
  orgSlug: string
  repoSlug: string
}

/** Linkify #123 (issues) and !123 (pull requests); highlight @mentions. */
export function preprocessCollaborationMarkdown(content: string, ctx: CollaborationContext) {
  let text = content
  text = text.replace(
    /(?<![\w/#])#(\d+)\b/g,
    (_, num) => `[#${num}](${issueUrl(ctx.orgSlug, ctx.repoSlug, Number(num))})`,
  )
  text = text.replace(
    /(?<![\w/!])!(\d+)\b/g,
    (_, num) => `[!${num}](${pullUrl(ctx.orgSlug, ctx.repoSlug, Number(num))})`,
  )
  text = text.replace(
    /(?<![\w/@])@([a-zA-Z0-9_-]{3,39})\b/g,
    '**@$1**',
  )
  return text
}

export function MarkdownBody({
  content,
  className,
  orgSlug,
  repoSlug,
}: {
  content: string
  className?: string
  orgSlug?: string
  repoSlug?: string
}) {
  const processed = useMemo(() => {
    if (orgSlug && repoSlug) {
      return preprocessCollaborationMarkdown(content, { orgSlug, repoSlug })
    }
    return content
  }, [content, orgSlug, repoSlug])

  return (
    <div className={className ?? 'markdown-viewer-content text-sm text-text prose prose-invert max-w-none'}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} className="text-primary hover:underline">
              {children}
            </a>
          ),
        }}
      >
        {processed}
      </ReactMarkdown>
    </div>
  )
}
