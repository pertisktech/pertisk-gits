import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, Loader2, Pencil, Plus, Tag, Trash2 } from 'lucide-react'
import { useState, type MouseEvent } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import type { PipelineRun, TagInfo } from '../api/types'
import { formatRelativeTime } from '../lib/relativeTime'
import { pipelineRunForTag } from '../lib/pipelineRunIndex'
import { useRepoPipelineRunsIndex } from '../hooks/useRepoPipelineRunsIndex'
import { ConfirmModal } from './ConfirmModal'
import { CreateTagDialog } from './CreateTagDialog'
import { EditTagDialog, type EditTagParams } from './EditTagDialog'
import { PipelineRunStatusLink } from './PipelineRunStatusLink'
import { commitUrl } from './RepoCommits'
import { EmptyState, PrimaryButton, TablePagination, Toolbar, ToolbarActions } from './ui'
import { useClientPagination } from '../lib/pagination'

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
  const [editTarget, setEditTarget] = useState<TagInfo | null>(null)
  const [editError, setEditError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

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

  const invalidateTags = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['repo-tags', orgSlug, repoSlug] }),
      queryClient.invalidateQueries({ queryKey: ['repo-browser', orgSlug, repoSlug] }),
    ])
  }

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
      await invalidateTags()
    },
    onError: (err) => {
      setCreateError((err as Error).message)
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ originalName, params }: { originalName: string; params: EditTagParams }) =>
      api.updateRepoTag(token!, orgSlug, repoSlug, originalName, {
        name: params.name,
        ...(params.targetRef ? { target_ref: params.targetRef } : {}),
        message: params.message,
      }),
    onSuccess: async () => {
      setEditError(null)
      setEditTarget(null)
      await invalidateTags()
    },
    onError: (err) => {
      setEditError((err as Error).message)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (tagName: string) => api.deleteRepoTag(token!, orgSlug, repoSlug, tagName),
    onSuccess: async () => {
      setDeleteError(null)
      setDeleteTarget(null)
      await invalidateTags()
    },
    onError: (err) => {
      setDeleteError((err as Error).message)
    },
  })

  const tags = data?.tags ?? []
  const {
    items: pageTags,
    page,
    setPage,
    pageSize,
    total,
  } = useClientPagination(tags)
  const { index: pipelineIndex } = useRepoPipelineRunsIndex(orgSlug, repoSlug, token)
  const branches = browserData?.browser.branches.length
    ? browserData.browser.branches
    : [defaultBranch]
  const canManage = Boolean(token)

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
        <Toolbar>
          <span className="text-xs text-text-secondary">
            {tags.length} tag{tags.length === 1 ? '' : 's'}
          </span>
          {canManage && (
            <ToolbarActions>
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
            </ToolbarActions>
          )}
        </Toolbar>

        {tags.length === 0 ? (
          <EmptyState
            icon={<Tag size={40} />}
            title="No tags yet"
            description="Create a tag to mark a release or snapshot of this repository."
            action={
              canManage ? (
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
            {pageTags.map((tag) => (
              <TagRow
                key={tag.name}
                tag={tag}
                orgSlug={orgSlug}
                repoSlug={repoSlug}
                canManage={canManage}
                pipelineRun={pipelineRunForTag(pipelineIndex, tag.name, tag.sha)}
                onEdit={() => {
                  setEditError(null)
                  setEditTarget(tag)
                }}
                onDelete={() => {
                  setDeleteError(null)
                  setDeleteTarget(tag.name)
                }}
              />
            ))}
          </ul>
        )}
        {total > 0 && (
          <TablePagination
            page={page}
            pageSize={pageSize}
            total={total}
            onPageChange={setPage}
            itemLabel="tags"
          />
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

      <EditTagDialog
        open={editTarget !== null}
        tag={editTarget}
        branches={branches}
        defaultBranch={defaultBranch}
        pending={updateMutation.isPending}
        error={editError}
        onClose={() => {
          if (!updateMutation.isPending) {
            setEditTarget(null)
            setEditError(null)
          }
        }}
        onSave={(params) => {
          if (editTarget) {
            updateMutation.mutate({ originalName: editTarget.name, params })
          }
        }}
      />

      <ConfirmModal
        open={deleteTarget !== null}
        variant="danger"
        title="Delete tag?"
        description={
          <>
            Permanently delete tag{' '}
            <strong className="font-mono text-text">{deleteTarget}</strong>. This cannot be undone.
            {deleteError && (
              <p className="mt-2 text-dashboard-danger">{deleteError}</p>
            )}
          </>
        }
        confirmLabel="Delete tag"
        loading={deleteMutation.isPending}
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget)
        }}
        onCancel={() => {
          if (!deleteMutation.isPending) {
            setDeleteTarget(null)
            setDeleteError(null)
          }
        }}
      />
    </>
  )
}

function TagRow({
  tag,
  orgSlug,
  repoSlug,
  canManage,
  pipelineRun,
  onEdit,
  onDelete,
}: {
  tag: TagInfo
  orgSlug: string
  repoSlug: string
  canManage: boolean
  pipelineRun?: PipelineRun
  onEdit: () => void
  onDelete: () => void
}) {
  const codePath = `/groups/${orgSlug}/projects/${repoSlug}?ref=${encodeURIComponent(tag.name)}&ref_kind=tag`

  return (
    <li className="commit-history-row">
      <div className="commit-history-row-link">
        <Tag size={16} className="commit-history-row-icon shrink-0" aria-hidden />
        <div className="commit-history-row-main">
          <div className="commit-history-row-title">
            <Link to={codePath} className="commit-history-subject font-medium">
              {tag.name}
            </Link>
            <Link to={commitUrl(orgSlug, repoSlug, tag.sha)} className="commit-history-sha">
              {tag.short_sha}
            </Link>
          </div>
          {tag.message && (
            <p className="commit-history-body">{tag.message}</p>
          )}
          <p className="commit-history-meta">
            {tag.tagger_name ? `${tag.tagger_name} · ` : null}
            {formatRelativeTime(tag.tagged_at)}
          </p>
        </div>
      </div>
      <PipelineRunStatusLink run={pipelineRun} orgSlug={orgSlug} repoSlug={repoSlug} />
      <CopyShaButton sha={tag.sha} label={`Copy commit SHA for ${tag.name}`} />
      {canManage && (
        <>
          <button
            type="button"
            className="commit-history-copy text-text-secondary hover:text-text"
            aria-label={`Edit tag ${tag.name}`}
            title="Edit tag"
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              onEdit()
            }}
          >
            <Pencil size={12} aria-hidden />
          </button>
          <button
            type="button"
            className="commit-history-copy text-text-secondary hover:text-dashboard-danger"
            aria-label={`Delete tag ${tag.name}`}
            title="Delete tag"
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              onDelete()
            }}
          >
            <Trash2 size={12} aria-hidden />
          </button>
        </>
      )}
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
