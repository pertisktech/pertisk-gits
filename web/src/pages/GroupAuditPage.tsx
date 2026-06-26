import { useQuery } from '@tanstack/react-query'
import { Download, ScrollText } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api } from '../api/client'
import type { AuditEventType } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { StatusBadge } from '../components/StatusBadge'
import { SecondaryButton } from '../components/ui'

const EVENT_TYPES: { value: '' | AuditEventType; label: string }[] = [
  { value: '', label: 'All events' },
  { value: 'login', label: 'Login' },
  { value: 'sso_login', label: 'SSO login' },
  { value: 'permission_change', label: 'Permission change' },
  { value: 'merge', label: 'Merge' },
  { value: 'import', label: 'Import' },
  { value: 'repo_access', label: 'Repo access' },
]

function eventVariant(type: AuditEventType) {
  if (type === 'merge') return 'green' as const
  if (type === 'import') return 'violet' as const
  if (type === 'permission_change') return 'violet' as const
  if (type === 'sso_login') return 'yellow' as const
  return 'gray' as const
}

export function GroupAuditPage() {
  const { slug = '' } = useParams()
  const { token } = useAuth()
  const [eventType, setEventType] = useState<'' | AuditEventType>('')
  const [exporting, setExporting] = useState(false)

  const { data: groups = [] } = useQuery({
    queryKey: ['organizations'],
    queryFn: () => api.listOrganizations(token!),
    enabled: Boolean(token),
  })
  const group = groups.find((g) => g.slug === slug)

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['audit-events', slug, eventType],
    queryFn: () =>
      api.listAuditEvents(token!, slug, {
        event_type: eventType || undefined,
        limit: 100,
      }),
    enabled: Boolean(token && slug),
  })

  const events = data?.events ?? []
  const total = data?.total ?? 0

  const subtitle = useMemo(
    () => `Security and activity events for ${group?.name ?? slug}. Visible to group owners and admins.`,
    [group?.name, slug],
  )

  async function onExport() {
    if (!token) return
    setExporting(true)
    try {
      const csv = await api.exportAuditEvents(token, slug, {
        event_type: eventType || undefined,
      })
      const blob = new Blob([csv], { type: 'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${slug}-audit.csv`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setExporting(false)
    }
  }

  return (
    <>
      <div className="app-repo-header mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="app-repo-title">
            <span>Audit log</span>
          </h1>
          <p className="app-repo-desc">{subtitle}</p>
        </div>
        <SecondaryButton type="button" disabled={exporting} onClick={onExport}>
          <Download size={14} />
          {exporting ? 'Exporting…' : 'Export CSV'}
        </SecondaryButton>
      </div>

      <div className="app-panel mb-4 max-w-5xl">
        <div className="app-panel-body flex flex-wrap gap-3 items-center">
          <label className="text-sm text-text-secondary flex items-center gap-2">
            <ScrollText size={15} />
            Filter
            <select
              className="app-field"
              value={eventType}
              onChange={(e) => setEventType(e.target.value as '' | AuditEventType)}
            >
              {EVENT_TYPES.map((opt) => (
                <option key={opt.value || 'all'} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <span className="text-sm text-text-secondary ml-auto">{total} event(s)</span>
        </div>
      </div>

      <div className="app-panel max-w-5xl">
        {isLoading && <div className="p-8 text-center text-text-secondary text-sm">Loading…</div>}

        {isError && (
          <div className="p-8 text-center text-sm text-dashboard-danger">
            {error instanceof Error ? error.message : 'Failed to load audit log'}
          </div>
        )}

        {!isLoading && !isError && events.length === 0 && (
          <div className="p-8 text-center text-text-secondary text-sm">No audit events yet.</div>
        )}

        {!isLoading && !isError && events.length > 0 && (
          <table className="app-list-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Event</th>
                <th>Action</th>
                <th>Actor</th>
                <th>Resource</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id}>
                  <td className="text-xs text-text-secondary whitespace-nowrap">
                    {new Date(event.created_at).toLocaleString()}
                  </td>
                  <td>
                    <StatusBadge variant={eventVariant(event.event_type)}>
                      {event.event_type.replace('_', ' ')}
                    </StatusBadge>
                  </td>
                  <td className="text-sm">{event.action}</td>
                  <td className="text-sm">
                    {event.actor ? `@${event.actor.username}` : '—'}
                  </td>
                  <td className="text-xs text-text-secondary">
                    {event.resource_type
                      ? `${event.resource_type}${event.resource_id ? ` · ${event.resource_id.slice(0, 8)}` : ''}`
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}
