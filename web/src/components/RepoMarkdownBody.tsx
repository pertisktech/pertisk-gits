import { useEffect, useMemo, useState, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api } from '../api/client'
import { preprocessRepoMarkdownHtmlImages } from '../lib/repoMarkdown'
import { resolveRepoAssetPath } from '../lib/repoPath'

const API_BASE = import.meta.env.VITE_API_BASE ?? '/api/v1'

function isAbsoluteAssetUrl(url: string) {
  return /^(https?:|data:|\/\/)/i.test(url)
}

function isRepoApiAssetUrl(url: string) {
  return url.startsWith(API_BASE)
}

function resolveRepoAssetUrl(
  href: string,
  markdownPath: string,
  orgSlug: string,
  repoSlug: string,
  ref: string,
  refKind: 'branch' | 'tag',
) {
  if (isAbsoluteAssetUrl(href)) return href
  const assetPath = resolveRepoAssetPath(markdownPath, href)
  if (!assetPath) return href
  return api.repoRawUrl(orgSlug, repoSlug, { ref, path: assetPath, ref_kind: refKind })
}

function RepoMarkdownImage({
  src,
  alt,
  token,
}: {
  src: string
  alt?: string
  token?: string | null
}) {
  const [displaySrc, setDisplaySrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null

    async function load() {
      setFailed(false)
      setDisplaySrc(null)

      if (isAbsoluteAssetUrl(src) && !isRepoApiAssetUrl(src)) {
        setDisplaySrc(src)
        return
      }

      const headers = new Headers()
      if (token) headers.set('Authorization', `Bearer ${token}`)

      try {
        const response = await fetch(src, { headers })
        if (!response.ok) throw new Error('Image load failed')
        const blob = await response.blob()
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setDisplaySrc(objectUrl)
      } catch {
        if (!cancelled) setFailed(true)
      }
    }

    void load()

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [src, token])

  if (failed) {
    return (
      <span className="repo-markdown-image-fallback" title={alt}>
        {alt ?? 'Image unavailable'}
      </span>
    )
  }

  if (!displaySrc) {
    return <span className="repo-markdown-image-loading" aria-hidden />
  }

  return <img src={displaySrc} alt={alt ?? ''} loading="lazy" className="repo-markdown-image" />
}

export function RepoMarkdownBody({
  content,
  markdownPath,
  orgSlug,
  repoSlug,
  ref,
  refKind = 'branch',
  token,
  className,
}: {
  content: string
  markdownPath: string
  orgSlug: string
  repoSlug: string
  ref: string
  refKind?: 'branch' | 'tag'
  token?: string | null
  className?: string
}) {
  const processedContent = useMemo(
    () => preprocessRepoMarkdownHtmlImages(content),
    [content],
  )

  const components = useMemo(
    () => ({
      img: ({ src, alt }: { src?: string; alt?: string }) => {
        if (!src) return null
        const resolvedSrc = resolveRepoAssetUrl(
          src,
          markdownPath,
          orgSlug,
          repoSlug,
          ref,
          refKind,
        )
        return <RepoMarkdownImage src={resolvedSrc} alt={alt} token={token} />
      },
      a: ({ href, children }: { href?: string; children?: ReactNode }) => (
        <a href={href} className="text-primary hover:underline" target="_blank" rel="noreferrer">
          {children}
        </a>
      ),
    }),
    [markdownPath, orgSlug, repoSlug, ref, refKind, token],
  )

  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {processedContent}
      </ReactMarkdown>
    </div>
  )
}
