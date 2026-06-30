import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, GitBranch, Loader2, Plus, Shield, Trash2 } from 'lucide-react'
import { useState, type MouseEvent } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import type { BranchInfo, PipelineRun } from '../api/types'
import { formatRelativeTime } from '../lib/relativeTime'
import { pipelineRunForBranch } from '../lib/pipelineRunIndex'
import { useRepoPipelineRunsIndex } from '../hooks/useRepoPipelineRunsIndex'
import { ConfirmModal } from './ConfirmModal'
import { CreateBranchDialog } from './CreateBranchDialog'
import { PipelineRunStatusLink } from './PipelineRunStatusLink'
import { commitUrl } from './RepoCommits'
import { EmptyState, PrimaryButton, TablePagination } from './ui'
import { useClientPagination } from '../lib/pagination'

interface RepoBranchesProps {
  token?: string | null
  orgSlug: string
  repoSlug: string
  defaultBranch: string
}

export function RepoBranches({ token, orgSlug, repoSlug, defaultBranch }: RepoBranchesProps) {
  const queryClient = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const { data: browserData } = useQuery({
    queryKey: ['repo-browser', orgSlug, repoSlug],
    queryFn: () => api.getRepoBrowser(orgSlug, repoSlug, token),
    enabled: Boolean(orgSlug && repoSlug),
  })

  const { data, isLoading, error } = useQuery({
    queryKey: ['repo-branches', orgSlug, repoSlug, token ?? 'public'],
    queryFn: () => api.getRepoBranches(orgSlug, repoSlug, token),
    enabled: Boolean(orgSlug && repoSlug),
  })

  const createMutation = useMutation({
    mutationFn: (payload: { name: string; sourceRef: string }) =>
      api.createRepoBranch(token!, orgSlug, repoSlug, {
        name: payload.name,
        source_ref: payload.sourceRef,
      }),
    onSuccess: async () => {
      setCreateError(null)
      setShowCreate(false)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['repo-branches', orgSlug, repoSlug] }),
        queryClient.invalidateQueries({ queryKey: ['repo-browser', orgSlug, repoSlug] }),
      ])
    },
    onError: (err) => {
      setCreateError((err as Error).message)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (branchName: string) =>
      api.deleteRepoBranch(token!, orgSlug, repoSlug, branchName),
    onSuccess: async () => {
      setDeleteError(null)
      setDeleteTarget(null)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['repo-branches', orgSlug, repoSlug] }),
        queryClient.invalidateQueries({ queryKey: ['repo-browser', orgSlug, repoSlug] }),
      ])
    },
    onError: (err) => {
      setDeleteError((err as Error).message)
    },
  })

  const branches = data?.branches ?? []
  const {
    items: pageBranches,
    page,
    setPage,
    pageSize,
    total,
  } = useClientPagination(branches)
  const { index: pipelineIndex } = useRepoPipelineRunsIndex(orgSlug, repoSlug, token)
  const sourceBranches = browserData?.browser.branches.length
    ? browserData.browser.branches
    : [defaultBranch]
  const repoEmpty = browserData?.browser.empty ?? false
  const canManage = Boolean(token) && !repoEmpty

  if (isLoading) {
    return (
      <div className="app-panel">
        <div className="app-panel-body flex items-center gap-2 text-text-secondary text-sm">
          <Loader2 size={16} className="animate-spin" />
          Loading branches…
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
            {branches.length} branch{branches.length === 1 ? '' : 'es'}
          </span>
          {canManage && (
            <PrimaryButton
              type="button"
              className="ml-auto"
              onClick={() => {
                setCreateError(null)
                setShowCreate(true)
              }}
            >
              <Plus size={14} />
              New branch
            </PrimaryButton>
          )}
        </div>

        {branches.length === 0 ? (
          <EmptyState
            icon={<GitBranch size={40} />}
            title="No branches yet"
            description={
              repoEmpty
                ? 'Push your first commit, then create branches from the default branch.'
                : 'Create a branch to start parallel work on this repository.'
            }
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
                  New branch
                </PrimaryButton>
              ) : undefined
            }
          />
        ) : (
          <ul className="commit-history-date-body">
            {pageBranches.map((branch) => (
              <BranchRow
                key={branch.name}
                branch={branch}
                orgSlug={orgSlug}
                repoSlug={repoSlug}
                defaultBranch={defaultBranch}
                canDelete={canManage && branch.name !== defaultBranch}
                pipelineRun={pipelineRunForBranch(pipelineIndex, branch.name, branch.sha)}
                onDelete={() => {
                  setDeleteError(null)
                  setDeleteTarget(branch.name)
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
            itemLabel="branches"
          />
        )}
      </div>

      <CreateBranchDialog
        open={showCreate}
        branches={sourceBranches}
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

      <ConfirmModal
        open={deleteTarget !== null}
        variant="danger"
        title="Delete branch?"
        description={
          <>
            Permanently delete branch{' '}
            <strong className="font-mono text-text">{deleteTarget}</strong>. This cannot be undone.
            {deleteError && (
              <p className="mt-2 text-dashboard-danger">{deleteError}</p>
            )}
          </>
        }
        confirmLabel="Delete branch"
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

function BranchRow({
  branch,
  orgSlug,
  repoSlug,
  defaultBranch,
  canDelete,
  pipelineRun,
  onDelete,
}: {
  branch: BranchInfo
  orgSlug: string
  repoSlug: string
  defaultBranch: string
  canDelete: boolean
  pipelineRun?: PipelineRun
  onDelete: () => void
}) {
  const isDefault = branch.name === defaultBranch
  const codePath = `/groups/${orgSlug}/projects/${repoSlug}`

  return (
    <li className="commit-history-row">
      <div className="commit-history-row-link">
        <GitBranch size={16} className="commit-history-row-icon shrink-0" aria-hidden />
        <div className="commit-history-row-main">
          <div className="commit-history-row-title">
            <Link to={codePath} className="commit-history-subject font-medium">
              {branch.name}
            </Link>
            {isDefault && (
              <span className="text-[10px] font-semibold uppercase tracking-wide text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                default
              </span>
            )}
            <Link to={commitUrl(orgSlug, repoSlug, branch.sha)} className="commit-history-sha">
              {branch.short_sha}
            </Link>
          </div>
          {branch.message && <p className="commit-history-body">{branch.message}</p>}
          <p className="commit-history-meta">
            {branch.author_name ? `${branch.author_name} · ` : null}
            {formatRelativeTime(branch.committed_at)}
          </p>
        </div>
      </div>
      <PipelineRunStatusLink run={pipelineRun} orgSlug={orgSlug} repoSlug={repoSlug} />
      <CopyShaButton sha={branch.sha} label={`Copy commit SHA for ${branch.name}`} />
      {canDelete ? (
        <button
          type="button"
          className="commit-history-copy text-text-secondary hover:text-dashboard-danger"
          aria-label={`Delete branch ${branch.name}`}
          title="Delete branch"
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onDelete()
          }}
        >
          <Trash2 size={12} aria-hidden />
        </button>
      ) : isDefault ? (
        <span
          className="commit-history-copy text-muted opacity-40"
          title="Default branch cannot be deleted"
          aria-hidden
        >
          <Shield size={12} />
        </span>
      ) : null}
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
