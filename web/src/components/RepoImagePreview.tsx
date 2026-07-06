import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../api/client'

interface RepoImagePreviewProps {
  orgSlug: string
  repoSlug: string
  ref: string
  refKind: 'branch' | 'tag'
  path: string
  token?: string | null
}

export function RepoImagePreview({
  orgSlug,
  repoSlug,
  ref,
  refKind,
  path,
  token,
}: RepoImagePreviewProps) {
  const [src, setSrc] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const fileName = path.split('/').pop() ?? path
  const rawUrl = api.repoRawUrl(orgSlug, repoSlug, { ref, path, ref_kind: refKind })

  useEffect(() => {
    let objectUrl: string | null = null
    let cancelled = false

    async function load() {
      try {
        const headers: HeadersInit = {}
        if (token) headers.Authorization = `Bearer ${token}`
        const response = await fetch(rawUrl, { headers })
        if (!response.ok) throw new Error('failed to load image')
        const blob = await response.blob()
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setSrc(objectUrl)
        setError(false)
      } catch {
        if (!cancelled) setError(true)
      }
    }

    setSrc(null)
    setError(false)
    void load()

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [rawUrl, token])

  if (error) {
    return (
      <p className="text-sm text-text-secondary p-6">
        Could not load image preview. Use Raw to download the file.
      </p>
    )
  }

  if (!src) {
    return (
      <div className="flex items-center gap-2 text-text-secondary text-sm p-6">
        <Loader2 size={16} className="animate-spin" />
        Loading image…
      </div>
    )
  }

  return (
    <div className="repo-image-preview p-6 flex justify-center bg-[color-mix(in_srgb,var(--color-naturals-n4)_35%,transparent)]">
      <img
        src={src}
        alt={fileName}
        className="max-w-full h-auto max-h-[min(70vh,900px)] rounded-md border border-naturals-n4 bg-surface object-contain"
      />
    </div>
  )
}
