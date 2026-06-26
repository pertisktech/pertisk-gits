import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { GitPullRequest, Loader2, Plus } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { pullUrl } from '../lib/collaboration'
import { ShellInlineTabs } from './AppSegment'
import { Card } from './Card'
import { Alert, PrimaryButton, EmptyState, SecondaryButton } from './ui'
import { FieldLabel, Input, Select, Textarea } from './ui/Input'

interface RepoPullRequestsProps {
  token?: string | null
  orgSlug: string
  repoSlug: string
  defaultBranch: string
}

export function RepoPullRequests({ token, orgSlug, repoSlug, defaultBranch }: RepoPullRequestsProps) {
  const queryClient = useQueryClient()
  const [stateFilter, setStateFilter] = useState<'open' | 'closed' | 'all'>('open')
  const [showNew, setShowNew] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [sourceBranch, setSourceBranch] = useState('')
  const [targetBranch, setTargetBranch] = useState(defaultBranch)

  const { data: browserData } = useQuery({
    queryKey: ['repo-browser', orgSlug, repoSlug],
    queryFn: () => api.getRepoBrowser(orgSlug, repoSlug, token),
    enabled: Boolean(orgSlug && repoSlug),
  })
  const branches = browserData?.browser.branches.length
    ? browserData.browser.branches
    : [defaultBranch]

  const { data, isLoading, error } = useQuery({
    queryKey: ['repo-pulls', orgSlug, repoSlug, stateFilter, token ?? 'public'],
    queryFn: () => api.listPullRequests(orgSlug, repoSlug, { state: stateFilter }, token),
    enabled: Boolean(orgSlug && repoSlug),
  })

  const createMutation = useMutation({
    mutationFn: () =>
      api.createPullRequest(token!, orgSlug, repoSlug, {
        title,
        body,
        source_branch: sourceBranch,
        target_branch: targetBranch,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repo-pulls', orgSlug, repoSlug] })
      setShowNew(false)
      setTitle('')
      setBody('')
      setSourceBranch('')
    },
  })

  if (isLoading) {
    return (
      <div className="shell-card">
        <div className="shell-card-body flex items-center gap-2 text-theme-sm text-gray-500 dark:text-gray-400">
          <Loader2 size={16} className="animate-spin" />
          Loading pull requests…
        </div>
      </div>
    )
  }

  if (error) {
    return <Alert>{(error as Error).message}</Alert>
  }

  const pulls = data?.pull_requests ?? []

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <ShellInlineTabs
          tabs={[
            { id: 'open', label: `${data?.open_count ?? 0} Open` },
            { id: 'closed', label: `${data?.closed_count ?? 0} Closed` },
            { id: 'all', label: 'All' },
          ]}
          active={stateFilter}
          onChange={(id) => setStateFilter(id as 'open' | 'closed' | 'all')}
        />
        {token && (
          <PrimaryButton type="button" className="ml-auto" onClick={() => setShowNew((v) => !v)}>
            <Plus size={14} />
            New pull request
          </PrimaryButton>
        )}
      </div>

      {showNew && token && (
        <Card title="New pull request">
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              createMutation.mutate()
            }}
          >
            <div className="flex flex-wrap items-center gap-2 text-theme-sm">
              <Select
                value={sourceBranch}
                onChange={(e) => setSourceBranch(e.target.value)}
                className="!w-auto !py-1.5"
                required
              >
                <option value="">Source branch</option>
                {branches.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </Select>
              <span className="text-gray-400">→</span>
              <Select
                value={targetBranch}
                onChange={(e) => setTargetBranch(e.target.value)}
                className="!w-auto !py-1.5"
                required
              >
                {branches.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </Select>
            </div>
            <FieldLabel label="Title">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Title"
                required
              />
            </FieldLabel>
            <FieldLabel label="Description">
              <Textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Describe your changes (Markdown supported)"
                rows={5}
              />
            </FieldLabel>
            <div className="flex gap-2">
              <PrimaryButton
                type="submit"
                disabled={createMutation.isPending || !title.trim() || !sourceBranch || sourceBranch === targetBranch}
              >
                {createMutation.isPending ? 'Creating…' : 'Create pull request'}
              </PrimaryButton>
              <SecondaryButton type="button" onClick={() => setShowNew(false)}>
                Cancel
              </SecondaryButton>
            </div>
            {createMutation.error && (
              <Alert>{(createMutation.error as Error).message}</Alert>
            )}
          </form>
        </Card>
      )}

      <div className="shell-card">
        {pulls.length === 0 ? (
          <EmptyState
            icon={<GitPullRequest size={40} />}
            title={stateFilter === 'open' ? 'No open pull requests' : 'No pull requests found'}
            description={
              stateFilter === 'open'
                ? 'Propose changes and review code before merging. GitLab users: these work like merge requests.'
                : 'Try a different filter.'
            }
            action={
              token && stateFilter !== 'closed' ? (
                <PrimaryButton type="button" onClick={() => setShowNew(true)} startIcon={<Plus size={14} />}>
                  New pull request
                </PrimaryButton>
              ) : undefined
            }
          />
        ) : (
          <ul className="divide-y divide-gray-200 dark:divide-gray-800">
            {pulls.map(({ pull_request: pr, author, review_summary: reviewSummary }) => (
              <li key={pr.id}>
                <Link
                  to={pullUrl(orgSlug, repoSlug, pr.number)}
                  className="flex items-start gap-3 px-4 py-3 no-underline text-inherit transition-colors hover:bg-gray-50 dark:hover:bg-white/5"
                >
                  <GitPullRequest
                    size={16}
                    className={
                      pr.state === 'open'
                        ? reviewSummary.approved_count > 0
                          ? 'mt-0.5 shrink-0 text-brand-500'
                          : 'mt-0.5 shrink-0 text-success-500'
                        : pr.state === 'merged'
                          ? 'mt-0.5 shrink-0 text-brand-500'
                          : 'mt-0.5 shrink-0 text-gray-400'
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-gray-800 dark:text-white/90">{pr.title}</span>
                      <span className="text-theme-xs text-gray-400">#{pr.number}</span>
                      {pr.state === 'open' && reviewSummary.approved_count > 0 && (
                        <span className="rounded-full bg-success-50 px-2 py-0.5 text-theme-xs text-success-600 dark:bg-success-500/15 dark:text-success-500">
                          Approved
                        </span>
                      )}
                      {pr.state === 'open' && reviewSummary.changes_requested_count > 0 && (
                        <span className="rounded-full bg-error-50 px-2 py-0.5 text-theme-xs text-error-600 dark:bg-error-500/15 dark:text-error-500">
                          Changes requested
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-theme-xs text-gray-500 dark:text-gray-400">
                      {pr.source_branch} → {pr.target_branch} · {author.username}
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
