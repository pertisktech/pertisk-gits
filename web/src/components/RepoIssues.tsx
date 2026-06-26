import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CircleDot, Loader2, MessageSquare, Plus } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { issueUrl } from '../lib/collaboration'
import { RepoLabelsPanel, RepoMilestonesPanel } from './IssueSidebar'
import { LabelBadge } from './LabelBadge'
import { ShellInlineTabs } from './AppSegment'
import { Card } from './Card'
import { Alert, EmptyState, PrimaryButton, SecondaryButton } from './ui'
import { FieldLabel, Input, Select, Textarea } from './ui/Input'

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
      <div className="shell-card">
        <div className="shell-card-body flex items-center gap-2 text-theme-sm text-gray-500 dark:text-gray-400">
          <Loader2 size={16} className="animate-spin" />
          Loading issues…
        </div>
      </div>
    )
  }

  if (error) {
    return <Alert>{(error as Error).message}</Alert>
  }

  const issues = data?.issues ?? []

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
        <Input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search issues…"
          className="max-w-xs !py-2"
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
        <Card title="New issue">
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              createMutation.mutate()
            }}
          >
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
                placeholder="Describe the issue — use @username, #123, !456 (Markdown supported)"
                rows={5}
              />
            </FieldLabel>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FieldLabel label="Assignee">
                <Select
                  value={assigneeId}
                  onChange={(e) => setAssigneeId(e.target.value)}
                  className="!py-2"
                >
                  <option value="">No assignee</option>
                  {members.map(({ user }) => (
                    <option key={user.id} value={user.id}>
                      @{user.username}
                    </option>
                  ))}
                </Select>
              </FieldLabel>
              <FieldLabel label="Milestone">
                <Select
                  value={milestoneId}
                  onChange={(e) => setMilestoneId(e.target.value)}
                  className="!py-2"
                >
                  <option value="">No milestone</option>
                  {milestones.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.title}
                    </option>
                  ))}
                </Select>
              </FieldLabel>
            </div>
            {allLabels.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {allLabels.map((label) => {
                  const active = selectedLabelIds.includes(label.id)
                  return (
                    <button
                      key={label.id}
                      type="button"
                      className={`rounded-full border ${active ? 'opacity-100 ring-1 ring-brand-500' : 'opacity-50'}`}
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
              <SecondaryButton type="button" onClick={() => setShowNew(false)}>
                Cancel
              </SecondaryButton>
            </div>
          </form>
        </Card>
      )}

      <div className="shell-card">
        {issues.length === 0 ? (
          <EmptyState
            icon={<CircleDot size={40} />}
            title={stateFilter === 'open' ? 'No open issues' : 'No issues found'}
            description={
              stateFilter === 'open'
                ? 'Track bugs, tasks, and ideas for this repository.'
                : 'Try a different filter or search term.'
            }
            action={
              token && stateFilter !== 'closed' ? (
                <PrimaryButton type="button" onClick={() => setShowNew(true)} startIcon={<Plus size={14} />}>
                  New issue
                </PrimaryButton>
              ) : undefined
            }
          />
        ) : (
          <ul className="divide-y divide-gray-200 dark:divide-gray-800">
            {issues.map(({ issue, author, labels, assignee }) => (
              <li key={issue.id}>
                <Link
                  to={issueUrl(orgSlug, repoSlug, issue.number)}
                  className="flex items-start gap-3 px-4 py-3 no-underline text-inherit transition-colors hover:bg-gray-50 dark:hover:bg-white/5"
                >
                  <CircleDot
                    size={16}
                    className={
                      issue.state === 'open'
                        ? 'mt-0.5 shrink-0 text-success-500'
                        : 'mt-0.5 shrink-0 text-gray-400'
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-gray-800 dark:text-white/90">{issue.title}</span>
                      <span className="text-theme-xs text-gray-400">#{issue.number}</span>
                      {labels.map((label) => (
                        <LabelBadge key={label.id} label={label} />
                      ))}
                    </div>
                    <div className="mt-1 text-theme-xs text-gray-500 dark:text-gray-400">
                      opened by {author.username}
                      {assignee ? ` · assigned to ${assignee.username}` : ''}
                      {' · '}
                      {new Date(issue.created_at).toLocaleDateString()}
                    </div>
                  </div>
                  <MessageSquare size={14} className="mt-1 shrink-0 text-gray-400" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
