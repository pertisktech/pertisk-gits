import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, Loader2, Plus, Tag } from 'lucide-react'
import { useState, type MouseEvent } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import type { TagInfo } from '../api/types'
import { formatRelativeTime } from '../lib/relativeTime'
import { CreateTagDialog } from './CreateTagDialog'
import { commitUrl } from './RepoCommits'
import { EmptyState, PrimaryButton } from './ui'

interface RepoTagsProps {
  token?: string | null
  orgSlug: string
  repoSlug: string
  defaultBranch: string
}

export function RepoTags({ token, orgSlug, repoSlug, defaultBranch }: RepoTagsProps) {
  const queryClient = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const { data: browserData } = useQuery({
    queryKey: ['repo-browser', orgSlug, repoSlug],
    queryFn: () => api.getRepoBrowser(orgSlug, repoSlug, token),
    enabled: Boolean(orgSlug && repoSlug),
  })

  const { data, isLoading, error } = useQuery({
    queryKey: ['repo-tags', orgSlug, repoSlug, token ?? 'public'],
    queryFn: () => api.getRepoTags(orgSlug, repoSlug, token),
    enabled: Boolean(orgSlug && repoSlug),
  })

  const createMutation = useMutation({
    mutationFn: (payload: { name: string; targetRef: string; message: string }) =>
      api.createRepoTag(token!, orgSlug, repoSlug, {
        name: payload.name,
        target_ref: payload.targetRef,
        message: payload.message || undefined,
      }),
    onSuccess: async () => {
      setCreateError(null)
      setShowCreate(false)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['repo-tags', orgSlug, repoSlug] }),
        queryClient.invalidateQueries({ queryKey: ['repo-browser', orgSlug, repoSlug] }),
      ])
    },
    onError: (err) => {
      setCreateError((err as Error).message)
    },
  })

  const tags = data?.tags ?? []
  const branches = browserData?.browser.branches.length
    ? browserData.browser.branches
    : [defaultBranch]
  const canCreate = Boolean(token)

  if (isLoading) {
    return (
      <div className="app-panel">
        <div className="app-panel-body flex items-center gap-2 text-text-secondary text-sm">
          <Loader2 size={16} className="animate-spin" />
          Loading tags…
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="app-panel">
        <div className="app-panel-body p-4 text-sm text-dashboard-danger">
          {(error as Error).message}
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="app-panel">
        <div className="app-toolbar flex-wrap gap-2">
          <span className="text-xs text-text-secondary">
            {tags.length} tag{tags.length === 1 ? '' : 's'}
          </span>
          {canCreate && (
            <PrimaryButton
              type="button"
              className="ml-auto"
              onClick={() => {
                setCreateError(null)
                setShowCreate(true)
              }}
            >
              <Plus size={14} />
              New tag
            </PrimaryButton>
          )}
        </div>

        {tags.length === 0 ? (
          <EmptyState
            icon={<Tag size={40} />}
            title="No tags yet"
            description="Create a tag to mark a release or snapshot of this repository."
            action={
              canCreate ? (
                <PrimaryButton
                  type="button"
                  onClick={() => {
                    setCreateError(null)
                    setShowCreate(true)
                  }}
                >
                  <Plus size={14} />
                  New tag
                </PrimaryButton>
              ) : undefined
            }
          />
        ) : (
          <ul className="commit-history-date-body">
            {tags.map((tag) => (
              <TagRow key={tag.name} tag={tag} orgSlug={orgSlug} repoSlug={repoSlug} />
            ))}
          </ul>
        )}
      </div>

      <CreateTagDialog
        open={showCreate}
        branches={branches}
        defaultBranch={defaultBranch}
        pending={createMutation.isPending}
        error={createError}
        onClose={() => {
          if (!createMutation.isPending) {
            setShowCreate(false)
            setCreateError(null)
          }
        }}
        onCreate={(params) => createMutation.mutate(params)}
      />
    </>
  )
}

function TagRow({
  tag,
  orgSlug,
  repoSlug,
}: {
  tag: TagInfo
  orgSlug: string
  repoSlug: string
}) {
  return (
    <li className="commit-history-row">
      <Link
        to={commitUrl(orgSlug, repoSlug, tag.sha)}
        className="commit-history-row-link"
      >
        <Tag size={16} className="commit-history-row-icon shrink-0" aria-hidden />
        <div className="commit-history-row-main">
          <div className="commit-history-row-title">
            <span className="commit-history-subject font-medium">{tag.name}</span>
            <code className="commit-history-sha">{tag.short_sha}</code>
            <CopyShaButton sha={tag.sha} label={`Copy commit SHA for ${tag.name}`} />
          </div>
          {tag.message && (
            <p className="commit-history-body">{tag.message}</p>
          )}
          <p className="commit-history-meta">
            {tag.tagger_name ? `${tag.tagger_name} · ` : null}
            {formatRelativeTime(tag.tagged_at)}
          </p>
        </div>
      </Link>
    </li>
  )
}

function CopyShaButton({ sha, label }: { sha: string; label: string }) {
  const [copied, setCopied] = useState(false)

  async function copy(event: MouseEvent) {
    event.preventDefault()
    event.stopPropagation()
    try {
      await navigator.clipboard.writeText(sha)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // clipboard may be unavailable
    }
  }

  return (
    <button
      type="button"
      className="commit-history-copy"
      aria-label={label}
      title={copied ? 'Copied' : 'Copy SHA'}
      onClick={copy}
    >
      {copied ? <Check size={12} aria-hidden /> : <Copy size={12} aria-hidden />}
    </button>
  )
}
