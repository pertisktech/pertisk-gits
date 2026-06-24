import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CircleDot, Loader2, MessageSquare, Plus } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { issueUrl } from '../lib/collaboration'
import { RepoLabelsPanel, RepoMilestonesPanel } from './IssueSidebar'
import { LabelBadge } from './LabelBadge'
import { PrimaryButton } from './ui'

interface RepoIssuesProps {
  token?: string | null
  orgSlug: string
  repoSlug: string
}

export function RepoIssues({ token, orgSlug, repoSlug }: RepoIssuesProps) {
  const queryClient = useQueryClient()
  const [stateFilter, setStateFilter] = useState<'open' | 'closed' | 'all'>('open')
  const [labelFilter, setLabelFilter] = useState<string | undefined>()
  const [search, setSearch] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [assigneeId, setAssigneeId] = useState('')
  const [milestoneId, setMilestoneId] = useState('')
  const [selectedLabelIds, setSelectedLabelIds] = useState<string[]>([])

  const { data: members = [] } = useQuery({
    queryKey: ['org-members', orgSlug],
    queryFn: () => api.listOrganizationMembers(token!, orgSlug),
    enabled: Boolean(token && orgSlug),
  })

  const { data: milestones = [] } = useQuery({
    queryKey: ['repo-milestones', orgSlug, repoSlug],
    queryFn: () => api.listMilestones(orgSlug, repoSlug, token),
    enabled: Boolean(orgSlug && repoSlug),
  })

  const { data: allLabels = [] } = useQuery({
    queryKey: ['repo-labels', orgSlug, repoSlug],
    queryFn: () => api.listLabels(orgSlug, repoSlug, token),
    enabled: Boolean(orgSlug && repoSlug),
  })

  const { data, isLoading, error } = useQuery({
    queryKey: ['repo-issues', orgSlug, repoSlug, stateFilter, labelFilter, search, token ?? 'public'],
    queryFn: () =>
      api.listIssues(
        orgSlug,
        repoSlug,
        { state: stateFilter, label: labelFilter, q: search || undefined },
        token,
      ),
    enabled: Boolean(orgSlug && repoSlug),
  })

  const createMutation = useMutation({
    mutationFn: () =>
      api.createIssue(token!, orgSlug, repoSlug, {
        title,
        body,
        assignee_id: assigneeId || null,
        milestone_id: milestoneId || null,
        label_ids: selectedLabelIds.length ? selectedLabelIds : undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repo-issues', orgSlug, repoSlug] })
      setShowNew(false)
      setTitle('')
      setBody('')
      setAssigneeId('')
      setMilestoneId('')
      setSelectedLabelIds([])
    },
  })

  if (isLoading) {
    return (
      <div className="app-panel">
        <div className="app-panel-body flex items-center gap-2 text-text-secondary text-sm">
          <Loader2 size={16} className="animate-spin" />
          Loading issues…
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-3 rounded-lg border border-red-r1/30 bg-dashboard-danger-bg text-dashboard-danger text-sm">
        {(error as Error).message}
      </div>
    )
  }

  const issues = data?.issues ?? []

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="app-segment inline-flex !mb-0 !border-b-0">
          {(['open', 'closed', 'all'] as const).map((state) => (
            <button
              key={state}
              type="button"
              className={`app-segment-tab ${stateFilter === state ? 'active' : ''}`}
              onClick={() => setStateFilter(state)}
            >
              {state === 'open' && `${data?.open_count ?? 0} Open`}
              {state === 'closed' && `${data?.closed_count ?? 0} Closed`}
              {state === 'all' && 'All'}
            </button>
          ))}
        </div>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search issues…"
          className="app-field max-w-xs !py-1.5 !text-sm"
        />
        {token && (
          <PrimaryButton type="button" className="ml-auto" onClick={() => setShowNew((v) => !v)}>
            <Plus size={14} />
            New issue
          </PrimaryButton>
        )}
      </div>

      {token && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <RepoLabelsPanel
            token={token}
            orgSlug={orgSlug}
            repoSlug={repoSlug}
            activeLabel={labelFilter}
            onFilterLabel={setLabelFilter}
          />
          <RepoMilestonesPanel token={token} orgSlug={orgSlug} repoSlug={repoSlug} />
        </div>
      )}

      {showNew && token && (
        <div className="app-panel">
          <div className="app-panel-header">New issue</div>
          <form
            className="app-panel-body space-y-3"
            onSubmit={(e) => {
              e.preventDefault()
              createMutation.mutate()
            }}
          >
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Title"
              required
              className="app-field"
            />
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Describe the issue — use @username, #123, !456 (Markdown supported)"
              rows={5}
              className="app-field resize-y"
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <select
                value={assigneeId}
                onChange={(e) => setAssigneeId(e.target.value)}
                className="app-field !py-1.5 !text-sm"
              >
                <option value="">No assignee</option>
                {members.map(({ user }) => (
                  <option key={user.id} value={user.id}>
                    @{user.username}
                  </option>
                ))}
              </select>
              <select
                value={milestoneId}
                onChange={(e) => setMilestoneId(e.target.value)}
                className="app-field !py-1.5 !text-sm"
              >
                <option value="">No milestone</option>
                {milestones.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.title}
                  </option>
                ))}
              </select>
            </div>
            {allLabels.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {allLabels.map((label) => {
                  const active = selectedLabelIds.includes(label.id)
                  return (
                    <button
                      key={label.id}
                      type="button"
                      className={`rounded-full border ${active ? 'opacity-100 ring-1 ring-primary' : 'opacity-50'}`}
                      style={{ borderColor: label.color }}
                      onClick={() =>
                        setSelectedLabelIds((ids) =>
                          active ? ids.filter((id) => id !== label.id) : [...ids, label.id],
                        )
                      }
                    >
                      <LabelBadge label={label} />
                    </button>
                  )
                })}
              </div>
            )}
            <div className="flex gap-2">
              <PrimaryButton type="submit" disabled={createMutation.isPending || !title.trim()}>
                {createMutation.isPending ? 'Creating…' : 'Create issue'}
              </PrimaryButton>
              <button type="button" className="px-3 py-2 text-sm text-text-secondary" onClick={() => setShowNew(false)}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="app-panel">
        {issues.length === 0 ? (
          <div className="app-panel-body text-center py-10 text-text-secondary text-sm">
            No issues found.
          </div>
        ) : (
          <ul className="divide-y divide-naturals-n4">
            {issues.map(({ issue, author, labels, assignee }) => (
              <li key={issue.id}>
                <Link
                  to={issueUrl(orgSlug, repoSlug, issue.number)}
                  className="flex items-start gap-3 px-4 py-3 hover:bg-hover no-underline text-inherit"
                >
                  <CircleDot
                    size={16}
                    className={issue.state === 'open' ? 'text-dashboard-success shrink-0 mt-0.5' : 'text-muted shrink-0 mt-0.5'}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-text">{issue.title}</span>
                      <span className="text-xs text-muted">#{issue.number}</span>
                      {labels.map((label) => (
                        <LabelBadge key={label.id} label={label} />
                      ))}
                    </div>
                    <div className="text-xs text-text-secondary mt-1">
                      opened by {author.username}
                      {assignee ? ` · assigned to ${assignee.username}` : ''}
                      {' · '}
                      {new Date(issue.created_at).toLocaleDateString()}
                    </div>
                  </div>
                  <MessageSquare size={14} className="text-muted shrink-0 mt-1" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
