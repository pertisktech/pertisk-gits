import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Tag, Target } from 'lucide-react'
import { useState } from 'react'
import { api } from '../api/client'
import type { IssueDetail, Milestone } from '../api/types'
import { LabelBadge } from './LabelBadge'
import { Alert, PrimaryButton } from './ui'
import { Input, Select, Textarea } from './ui/Input'

interface IssueSidebarProps {
  token: string
  orgSlug: string
  repoSlug: string
  issueNumber: number
  data: IssueDetail
}

export function IssueSidebar({ token, orgSlug, repoSlug, issueNumber, data }: IssueSidebarProps) {
  const queryClient = useQueryClient()
  const { issue, assignee, milestone, labels } = data

  const { data: members = [] } = useQuery({
    queryKey: ['org-members', orgSlug],
    queryFn: () => api.listOrganizationMembers(token, orgSlug),
    enabled: Boolean(token && orgSlug),
  })

  const { data: allLabels = [] } = useQuery({
    queryKey: ['repo-labels', orgSlug, repoSlug],
    queryFn: () => api.listLabels(orgSlug, repoSlug, token),
    enabled: Boolean(orgSlug && repoSlug),
  })

  const { data: milestones = [] } = useQuery({
    queryKey: ['repo-milestones', orgSlug, repoSlug],
    queryFn: () => api.listMilestones(orgSlug, repoSlug, token),
    enabled: Boolean(orgSlug && repoSlug),
  })

  const updateMutation = useMutation({
    mutationFn: (payload: {
      assignee_id?: string | null
      milestone_id?: string | null
      label_ids?: string[]
    }) => api.updateIssue(token, orgSlug, repoSlug, issueNumber, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['issue', orgSlug, repoSlug, issueNumber] })
      queryClient.invalidateQueries({ queryKey: ['repo-issues', orgSlug, repoSlug] })
    },
  })

  const selectedLabelIds = new Set(labels.map((l) => l.id))

  function toggleLabel(labelId: string) {
    const next = new Set(selectedLabelIds)
    if (next.has(labelId)) next.delete(labelId)
    else next.add(labelId)
    updateMutation.mutate({ label_ids: [...next] })
  }

  return (
    <aside className="app-issue-sidebar space-y-3">
      <div className="shell-card">
        <div className="shell-card-header">Assignees</div>
        <div className="shell-card-body">
          <Select
            value={assignee?.id ?? ''}
            onChange={(e) =>
              updateMutation.mutate({
                assignee_id: e.target.value || null,
              })
            }
            className="!py-2 text-theme-sm"
            disabled={updateMutation.isPending}
          >
            <option value="">No assignee</option>
            {members.map(({ user }) => (
              <option key={user.id} value={user.id}>
                @{user.username}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="shell-card">
        <div className="shell-card-header flex items-center gap-1.5">
          <Tag size={14} />
          Labels
        </div>
        <div className="shell-card-body space-y-2">
          {allLabels.length === 0 ? (
            <p className="text-theme-xs text-gray-500 dark:text-gray-400">No labels yet.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {allLabels.map((label) => {
                const active = selectedLabelIds.has(label.id)
                return (
                  <button
                    key={label.id}
                    type="button"
                    className={`rounded-full border transition-opacity ${active ? 'opacity-100' : 'opacity-40 hover:opacity-70'}`}
                    style={{ borderColor: label.color }}
                    onClick={() => toggleLabel(label.id)}
                    disabled={updateMutation.isPending}
                    title={active ? 'Remove label' : 'Add label'}
                  >
                    <LabelBadge label={label} />
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <div className="shell-card">
        <div className="shell-card-header">Milestone</div>
        <div className="shell-card-body">
          <Select
            value={milestone?.id ?? ''}
            onChange={(e) =>
              updateMutation.mutate({
                milestone_id: e.target.value || null,
              })
            }
            className="!py-2 text-theme-sm"
            disabled={updateMutation.isPending}
          >
            <option value="">No milestone</option>
            {milestones.map((m: Milestone) => (
              <option key={m.id} value={m.id}>
                {m.title}
                {m.due_on ? ` · due ${m.due_on}` : ''}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="shell-card">
        <div className="shell-card-header">Metadata</div>
        <div className="shell-card-body space-y-1 text-theme-xs text-gray-500 dark:text-gray-400">
          <div>
            State: <span className="text-gray-800 dark:text-white/90">{issue.state}</span>
          </div>
          {assignee && (
            <div>
              Assigned to <span className="text-gray-800 dark:text-white/90">@{assignee.username}</span>
            </div>
          )}
          {milestone && (
            <div>
              Milestone: <span className="text-gray-800 dark:text-white/90">{milestone.title}</span>
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}

interface RepoLabelsPanelProps {
  token: string
  orgSlug: string
  repoSlug: string
  activeLabel?: string
  onFilterLabel: (name: string | undefined) => void
}

export function RepoLabelsPanel({ token, orgSlug, repoSlug, activeLabel, onFilterLabel }: RepoLabelsPanelProps) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [color, setColor] = useState('#6366f1')
  const [showForm, setShowForm] = useState(false)

  const { data: labels = [] } = useQuery({
    queryKey: ['repo-labels', orgSlug, repoSlug],
    queryFn: () => api.listLabels(orgSlug, repoSlug, token),
    enabled: Boolean(orgSlug && repoSlug),
  })

  const createMutation = useMutation({
    mutationFn: () => api.createLabel(token, orgSlug, repoSlug, { name, color }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repo-labels', orgSlug, repoSlug] })
      setName('')
      setShowForm(false)
    },
  })

  return (
    <div className="shell-card">
      <div className="shell-card-header gap-2">
        <span className="flex items-center gap-1.5">
          <Tag size={14} />
          Labels
        </span>
        <button
          type="button"
          className="text-theme-xs font-normal text-brand-500 hover:text-brand-600 dark:text-brand-400"
          onClick={() => setShowForm((v) => !v)}
        >
          {showForm ? 'Cancel' : 'New label'}
        </button>
      </div>
      <div className="shell-card-body space-y-3">
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            className={`rounded-full border px-2 py-0.5 text-theme-xs ${
              !activeLabel
                ? 'border-brand-500 text-brand-500 dark:text-brand-400'
                : 'border-gray-200 text-gray-500 dark:border-gray-700 dark:text-gray-400'
            }`}
            onClick={() => onFilterLabel(undefined)}
          >
            All
          </button>
          {labels.map((label) => (
            <button
              key={label.id}
              type="button"
              onClick={() => onFilterLabel(label.name)}
              className={activeLabel === label.name ? 'rounded-full ring-1 ring-brand-500' : ''}
            >
              <LabelBadge label={label} />
            </button>
          ))}
        </div>

        {showForm && (
          <form
            className="flex flex-wrap items-end gap-2 border-t border-gray-200 pt-3 dark:border-gray-800"
            onSubmit={(e) => {
              e.preventDefault()
              createMutation.mutate()
            }}
          >
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Label name"
              required
              className="min-w-[8rem] flex-1 !py-2 text-theme-sm"
            />
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="h-10 w-12 cursor-pointer rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900"
              title="Label color"
            />
            <PrimaryButton type="submit" disabled={createMutation.isPending || !name.trim()}>
              Create
            </PrimaryButton>
          </form>
        )}
      </div>
    </div>
  )
}

interface RepoMilestonesPanelProps {
  token: string
  orgSlug: string
  repoSlug: string
}

export function RepoMilestonesPanel({ token, orgSlug, repoSlug }: RepoMilestonesPanelProps) {
  const queryClient = useQueryClient()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [dueOn, setDueOn] = useState('')
  const [showForm, setShowForm] = useState(false)

  const { data: milestones = [] } = useQuery({
    queryKey: ['repo-milestones', orgSlug, repoSlug],
    queryFn: () => api.listMilestones(orgSlug, repoSlug, token),
    enabled: Boolean(orgSlug && repoSlug),
  })

  const createMutation = useMutation({
    mutationFn: () =>
      api.createMilestone(token, orgSlug, repoSlug, {
        title,
        description: description.trim() ? description : undefined,
        due_on: dueOn || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repo-milestones', orgSlug, repoSlug] })
      setTitle('')
      setDescription('')
      setDueOn('')
      setShowForm(false)
    },
  })

  return (
    <div className="shell-card">
      <div className="shell-card-header gap-2">
        <span className="flex items-center gap-1.5">
          <Target size={14} />
          Milestones
        </span>
        <button
          type="button"
          className="text-theme-xs font-normal text-brand-500 hover:text-brand-600 dark:text-brand-400"
          onClick={() => setShowForm((v) => !v)}
        >
          {showForm ? 'Cancel' : 'New milestone'}
        </button>
      </div>
      <div className="shell-card-body space-y-3">
        {milestones.length === 0 && !showForm && (
          <p className="text-theme-xs text-gray-500 dark:text-gray-400">No milestones yet.</p>
        )}
        {milestones.length > 0 && (
          <ul className="space-y-2 text-theme-sm">
            {milestones.map((milestone) => (
              <li key={milestone.id} className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-medium text-gray-800 dark:text-white/90">{milestone.title}</div>
                  {milestone.description && (
                    <div className="mt-0.5 text-theme-xs text-gray-500 dark:text-gray-400">
                      {milestone.description}
                    </div>
                  )}
                </div>
                {milestone.due_on && (
                  <span className="whitespace-nowrap text-theme-xs text-gray-400">due {milestone.due_on}</span>
                )}
              </li>
            ))}
          </ul>
        )}

        {showForm && (
          <form
            className="space-y-2 border-t border-gray-200 pt-3 dark:border-gray-800"
            onSubmit={(e) => {
              e.preventDefault()
              createMutation.mutate()
            }}
          >
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Milestone title"
              required
              className="!py-2 text-theme-sm"
            />
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Description (optional)"
              rows={2}
              className="!py-2 text-theme-sm"
            />
            <Input
              type="date"
              value={dueOn}
              onChange={(e) => setDueOn(e.target.value)}
              className="!py-2 text-theme-sm"
            />
            <PrimaryButton type="submit" disabled={createMutation.isPending || !title.trim()}>
              Create milestone
            </PrimaryButton>
            {createMutation.error && (
              <Alert>{(createMutation.error as Error).message}</Alert>
            )}
          </form>
        )}
      </div>
    </div>
  )
}
