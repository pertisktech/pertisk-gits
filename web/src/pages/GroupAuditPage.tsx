import { useQuery } from '@tanstack/react-query'
import { Download, Loader2, ScrollText } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api } from '../api/client'
import type { AuditEventType } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { StatusBadge } from '../components/StatusBadge'
import { Alert, Breadcrumbs, PageHeader, SecondaryButton } from '../components/ui'
import { FieldLabel, Select } from '../components/ui/Input'

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
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Groups', to: '/groups' },
          { label: group?.name ?? slug, to: `/groups/${slug}` },
          { label: 'Audit log' },
        ]}
      />
      <PageHeader
        title="Audit log"
        subtitle={subtitle}
        action={
          <SecondaryButton type="button" disabled={exporting} onClick={onExport} startIcon={<Download size={16} />}>
            {exporting ? 'Exporting…' : 'Export CSV'}
          </SecondaryButton>
        }
      />

      <div className="shell-card max-w-5xl">
        <div className="shell-card-body flex flex-wrap items-center gap-4 !py-4">
          <FieldLabel label="Filter">
            <div className="flex items-center gap-2">
              <ScrollText size={15} className="text-gray-400" />
              <Select
                value={eventType}
                onChange={(e) => setEventType(e.target.value as '' | AuditEventType)}
                className="!w-auto min-w-[12rem]"
              >
                {EVENT_TYPES.map((opt) => (
                  <option key={opt.value || 'all'} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </Select>
            </div>
          </FieldLabel>
          <span className="ml-auto text-theme-sm text-gray-500 dark:text-gray-400">{total} event(s)</span>
        </div>
      </div>

      <div className="shell-card max-w-5xl">
        {isLoading && (
          <div className="shell-card-body flex items-center justify-center gap-2 py-12 text-theme-sm text-gray-500 dark:text-gray-400">
            <Loader2 size={16} className="animate-spin" />
            Loading audit log…
          </div>
        )}

        {isError && (
          <div className="shell-card-body">
            <Alert>{error instanceof Error ? error.message : 'Failed to load audit log'}</Alert>
          </div>
        )}

        {!isLoading && !isError && events.length === 0 && (
          <div className="shell-card-body py-12 text-center text-theme-sm text-gray-500 dark:text-gray-400">
            No audit events yet.
          </div>
        )}

        {!isLoading && !isError && events.length > 0 && (
          <div className="overflow-x-auto">
            <table className="shell-table w-full">
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
                    <td className="whitespace-nowrap text-theme-xs text-gray-500 dark:text-gray-400">
                      {new Date(event.created_at).toLocaleString()}
                    </td>
                    <td>
                      <StatusBadge variant={eventVariant(event.event_type)}>
                        {event.event_type.replace('_', ' ')}
                      </StatusBadge>
                    </td>
                    <td className="text-theme-sm">{event.action}</td>
                    <td className="text-theme-sm">
                      {event.actor ? `@${event.actor.username}` : '—'}
                    </td>
                    <td className="text-theme-xs text-gray-500 dark:text-gray-400">
                      {event.resource_type
                        ? `${event.resource_type}${event.resource_id ? ` · ${event.resource_id.slice(0, 8)}` : ''}`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
