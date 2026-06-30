import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Tag, Target } from 'lucide-react'
import { useState } from 'react'
import { api } from '../api/client'
import type { IssueDetail, Milestone } from '../api/types'
import { LabelBadge } from './LabelBadge'
import { PrimaryButton, Select } from './ui'

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
      <div className="app-panel">
        <div className="app-panel-header">Assignees</div>
        <div className="app-panel-body">
          <Select
            value={assignee?.id ?? ''}
            onChange={(e) =>
              updateMutation.mutate({
                assignee_id: e.target.value || null,
              })
            }
            className="!py-1.5 !text-sm"
            disabled={updateMutation.isPending}
            aria-label="Assignee"
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

      <div className="app-panel">
        <div className="app-panel-header flex items-center gap-1.5">
          <Tag size={14} />
          Labels
        </div>
        <div className="app-panel-body space-y-2">
          {allLabels.length === 0 ? (
            <p className="text-xs text-text-secondary">No labels yet.</p>
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

      <div className="app-panel">
        <div className="app-panel-header">Milestone</div>
        <div className="app-panel-body">
          <Select
            value={milestone?.id ?? ''}
            onChange={(e) =>
              updateMutation.mutate({
                milestone_id: e.target.value || null,
              })
            }
            className="!py-1.5 !text-sm"
            disabled={updateMutation.isPending}
            aria-label="Milestone"
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

      <div className="app-panel">
        <div className="app-panel-header">Metadata</div>
        <div className="app-panel-body text-xs text-text-secondary space-y-1">
          <div>State: <span className="text-text">{issue.state}</span></div>
          {assignee && (
            <div>
              Assigned to <span className="text-text">@{assignee.username}</span>
            </div>
          )}
          {milestone && (
            <div>
              Milestone: <span className="text-text">{milestone.title}</span>
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
    <div className="app-panel">
      <div className="app-panel-header flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5">
          <Tag size={14} />
          Labels
        </span>
        <button
          type="button"
          className="text-xs text-primary hover:underline"
          onClick={() => setShowForm((v) => !v)}
        >
          {showForm ? 'Cancel' : 'New label'}
        </button>
      </div>
      <div className="app-panel-body space-y-3">
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            className={`text-xs px-2 py-0.5 rounded-full border ${!activeLabel ? 'border-primary text-primary' : 'border-naturals-n4 text-text-secondary'}`}
            onClick={() => onFilterLabel(undefined)}
          >
            All
          </button>
          {labels.map((label) => (
            <button
              key={label.id}
              type="button"
              onClick={() => onFilterLabel(label.name)}
              className={activeLabel === label.name ? 'ring-1 ring-primary rounded-full' : ''}
            >
              <LabelBadge label={label} />
            </button>
          ))}
        </div>

        {showForm && (
          <form
            className="flex flex-wrap items-end gap-2 pt-2 border-t border-naturals-n4"
            onSubmit={(e) => {
              e.preventDefault()
              createMutation.mutate()
            }}
          >
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Label name"
              required
              className="app-field flex-1 min-w-[8rem] !py-1.5 !text-sm"
            />
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="h-9 w-12 rounded border border-naturals-n4 bg-surface cursor-pointer"
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
    <div className="app-panel">
      <div className="app-panel-header flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5">
          <Target size={14} />
          Milestones
        </span>
        <button
          type="button"
          className="text-xs text-primary hover:underline"
          onClick={() => setShowForm((v) => !v)}
        >
          {showForm ? 'Cancel' : 'New milestone'}
        </button>
      </div>
      <div className="app-panel-body space-y-3">
        {milestones.length === 0 && !showForm && (
          <p className="text-xs text-text-secondary">No milestones yet.</p>
        )}
        {milestones.length > 0 && (
          <ul className="space-y-2 text-sm">
            {milestones.map((milestone) => (
              <li key={milestone.id} className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-medium text-text">{milestone.title}</div>
                  {milestone.description && (
                    <div className="text-xs text-text-secondary mt-0.5">{milestone.description}</div>
                  )}
                </div>
                {milestone.due_on && (
                  <span className="text-xs text-muted whitespace-nowrap">due {milestone.due_on}</span>
                )}
              </li>
            ))}
          </ul>
        )}

        {showForm && (
          <form
            className="space-y-2 pt-2 border-t border-naturals-n4"
            onSubmit={(e) => {
              e.preventDefault()
              createMutation.mutate()
            }}
          >
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Milestone title"
              required
              className="app-field w-full !py-1.5 !text-sm"
            />
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Description (optional)"
              rows={2}
              className="app-field w-full !py-1.5 !text-sm resize-y"
            />
            <input
              type="date"
              value={dueOn}
              onChange={(e) => setDueOn(e.target.value)}
              className="app-field w-full !py-1.5 !text-sm"
            />
            <PrimaryButton type="submit" disabled={createMutation.isPending || !title.trim()}>
              Create milestone
            </PrimaryButton>
            {createMutation.error && (
              <p className="text-xs text-dashboard-danger">{(createMutation.error as Error).message}</p>
            )}
          </form>
        )}
      </div>
    </div>
  )
}
