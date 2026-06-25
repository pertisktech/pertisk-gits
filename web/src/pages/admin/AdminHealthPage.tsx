import { useQuery } from '@tanstack/react-query'
import { Loader2, RefreshCw } from 'lucide-react'
import { api } from '../../api/client'
import { useAuth } from '../../auth/AuthContext'
import { InfoPanel, InfoRow } from '../../components/AdminInfoPanel'
import { StatusBadge } from '../../components/StatusBadge'
import { Breadcrumbs, PageHeader, SecondaryButton } from '../../components/ui'
import { formatDateTime } from '../../lib/collaboration'

export function AdminHealthPage() {
  const { token } = useAuth()

  const { data, isLoading, error, isFetching, refetch } = useQuery({
    queryKey: ['admin-health'],
    queryFn: () => api.getAdminHealth(token!),
    enabled: Boolean(token),
    refetchInterval: 30_000,
  })

  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Admin', to: '/admin' },
          { label: 'Health check' },
        ]}
      />
      <PageHeader
        title="Health check"
        subtitle="Live service and database connectivity status."
        action={
          <SecondaryButton type="button" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw size={14} className={isFetching ? 'animate-spin' : undefined} />
            Refresh
          </SecondaryButton>
        }
      />

      {isLoading && (
        <div className="flex items-center gap-2 text-text-secondary text-sm py-8">
          <Loader2 size={16} className="animate-spin" />
          Running health check…
        </div>
      )}

      {error && (
        <div className="p-3 rounded-lg border border-red-r1/30 bg-dashboard-danger-bg text-dashboard-danger text-sm">
          {(error as Error).message}
        </div>
      )}

      {data && (
        <div className="space-y-4 max-w-3xl">
          <InfoPanel title="Status">
            <InfoRow
              label="Overall"
              value={
                <StatusBadge variant={data.status === 'ok' ? 'green' : 'red'}>
                  {data.status}
                </StatusBadge>
              }
            />
            <InfoRow label="Checked at" value={formatDateTime(data.checked_at)} />
            <InfoRow label="Version" value={<code>{data.version}</code>} />
            <InfoRow label="Public API URL" value={<code>{data.api_url}</code>} />
          </InfoPanel>

          <InfoPanel title="Database">
            <InfoRow
              label="Connection"
              value={
                <StatusBadge variant={data.database === 'ok' ? 'green' : 'red'}>
                  {data.database}
                </StatusBadge>
              }
            />
            <InfoRow label="Latency" value={`${data.database_latency_ms} ms`} />
            <InfoRow label="Server" value={<code className="text-xs">{data.database_version}</code>} />
          </InfoPanel>
        </div>
      )}
    </>
  )
}
